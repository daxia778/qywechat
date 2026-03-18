package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"

	"pdd-order-system/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

// ─── OSS 文件上传服务 ────────────────────────────────────
// 支持 "local"（本地 uploads 目录）和 "aliyun"/"s3" 两种模式
// 通过 OSS_PROVIDER 环境变量切换

// UploadResult 上传结果
type UploadResult struct {
	URL      string `json:"url"`       // 公网可访问 URL
	FilePath string `json:"file_path"` // 内部路径 (local 模式为磁盘路径, oss 模式为对象 key)
}

// allowedImageExts 允许上传的文件扩展名白名单
var allowedImageExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".gif":  true,
	".bmp":  true,
}

// UploadFile 上传文件到配置的存储后端
func UploadFile(fileHeader *multipart.FileHeader, subDir string) (*UploadResult, error) {
	// 校验文件扩展名，防止上传恶意文件类型 (.html/.exe/.php 等)
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if !allowedImageExts[ext] {
		return nil, fmt.Errorf("不支持的文件类型 %s，仅允许上传图片 (jpg/png/webp/gif/bmp)", ext)
	}

	provider := strings.ToLower(config.C.OSSProvider)

	switch provider {
	case "aliyun", "s3":
		return uploadToS3(fileHeader, subDir)
	default:
		return uploadToLocal(fileHeader, subDir)
	}
}

// ─── 本地上传 (开发模式) ────────────────────────────────

func uploadToLocal(fh *multipart.FileHeader, subDir string) (*UploadResult, error) {
	dir := filepath.Join("uploads", subDir)
	os.MkdirAll(dir, 0o755)

	ext := filepath.Ext(fh.Filename)
	filename := uuid.New().String() + ext
	savePath := filepath.Join(dir, filename)

	src, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("打开上传文件失败: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(savePath)
	if err != nil {
		return nil, fmt.Errorf("创建本地文件失败: %w", err)
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return nil, fmt.Errorf("写入本地文件失败: %w", err)
	}

	return &UploadResult{
		URL:      "/" + savePath, // 本地模式返回相对路径
		FilePath: savePath,
	}, nil
}

// ─── S3/阿里云 OSS 上传 ─────────────────────────────────

var s3Client *s3.Client

func getS3Client() (*s3.Client, error) {
	if s3Client != nil {
		return s3Client, nil
	}

	ctx := context.Background()

	// 自定义 endpoint (阿里云 OSS 兼容 S3 协议)
	customResolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			if config.C.OSSEndpoint != "" {
				return aws.Endpoint{
					URL:               config.C.OSSEndpoint,
					HostnameImmutable: true,
				}, nil
			}
			return aws.Endpoint{}, &aws.EndpointNotFoundError{}
		},
	)

	cfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(config.C.OSSRegion),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			config.C.OSSAccessKey,
			config.C.OSSSecretKey,
			"",
		)),
		awsconfig.WithEndpointResolverWithOptions(customResolver),
	)
	if err != nil {
		return nil, fmt.Errorf("初始化 S3 配置失败: %w", err)
	}

	s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true // 阿里云 OSS 兼容模式
	})

	log.Printf("✅ OSS 客户端初始化完成 (Endpoint: %s, Bucket: %s)", config.C.OSSEndpoint, config.C.OSSBucket)
	return s3Client, nil
}

func uploadToS3(fh *multipart.FileHeader, subDir string) (*UploadResult, error) {
	client, err := getS3Client()
	if err != nil {
		return nil, err
	}

	src, err := fh.Open()
	if err != nil {
		return nil, fmt.Errorf("打开上传文件失败: %w", err)
	}
	defer src.Close()

	ext := filepath.Ext(fh.Filename)
	objectKey := fmt.Sprintf("%s/%s/%s%s",
		subDir,
		time.Now().Format("2006/01/02"),
		uuid.New().String(),
		ext,
	)

	contentType := "application/octet-stream"
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".png":
		contentType = "image/png"
	case ".webp":
		contentType = "image/webp"
	case ".gif":
		contentType = "image/gif"
	}

	_, err = client.PutObject(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(config.C.OSSBucket),
		Key:         aws.String(objectKey),
		Body:        src,
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return nil, fmt.Errorf("上传到 OSS 失败: %w", err)
	}

	// 拼接公网 URL
	publicURL := fmt.Sprintf("%s/%s", strings.TrimRight(config.C.OSSBaseURL, "/"), objectKey)

	log.Printf("✅ 文件上传 OSS 成功: %s", objectKey)
	return &UploadResult{
		URL:      publicURL,
		FilePath: objectKey,
	}, nil
}
