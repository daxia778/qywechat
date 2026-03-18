package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"

	"github.com/denisbrodbeck/machineid"
)

const appSalt = "pdd-dispatch-2026"

// GetMachineFingerprint 生成高强度设备指纹
// 基于操作系统底层硬件 UUID（macOS: IOPlatformUUID, Windows: MachineGuid），
// 拼接应用级盐值进行 SHA256 哈希，生成不可逆的唯一标识。
// 与 MAC 地址不同，这个 ID 无法通过简单修改网卡属性来伪造。
func GetMachineFingerprint() (string, error) {
	id, err := machineid.ProtectedID(appSalt)
	if err != nil {
		return "", fmt.Errorf("获取设备指纹失败: %w", err)
	}
	return id, nil
}

// deriveKey 从设备指纹派生出 AES-256 密钥 (32 字节)
func deriveKey(machineID string) []byte {
	hash := sha256.Sum256([]byte(machineID + ":session-key"))
	return hash[:]
}

// EncryptSession 使用 AES-256-GCM 加密会话数据
// 加密密钥基于设备指纹派生，因此同一份密文在其他机器上无法解密
func EncryptSession(plaintext []byte, machineID string) (string, error) {
	key := deriveKey(machineID)

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("创建加密器失败: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("创建 GCM 失败: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("生成随机数失败: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, plaintext, nil)
	return hex.EncodeToString(ciphertext), nil
}

// DecryptSession 使用 AES-256-GCM 解密会话数据
// 如果设备指纹与加密时不同（例如文件被复制到其他机器），解密将失败
func DecryptSession(encrypted string, machineID string) ([]byte, error) {
	key := deriveKey(machineID)

	ciphertext, err := hex.DecodeString(encrypted)
	if err != nil {
		return nil, fmt.Errorf("hex 解码失败: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("创建解密器失败: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("创建 GCM 失败: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, fmt.Errorf("密文数据损坏")
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		log.Printf("⚠️ 会话解密失败 (可能是设备指纹不匹配): %v", err)
		return nil, fmt.Errorf("会话解密失败: 设备指纹不匹配或数据已损坏")
	}

	return plaintext, nil
}
