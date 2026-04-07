package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	corpID        = "wwdb2f088115fa0fff"
	corpSecret    = "fdaIml1ODRNKyZFPNF04kZz7zn0Mfv8yqW78Fr7zYh0"
	contactSecret = "fdaIml1ODRNKyZFPNF04kZz7zn0Mfv8yqW78Fr7zYh0" // 客户联系 secret
	baseURL       = "https://qyapi.weixin.qq.com/cgi-bin"
	testPhone     = "13226523959" // 测试外部联系人手机号
)

var client = &http.Client{Timeout: 15 * time.Second}

// ─── 通用工具 ───────────────────────────

func getAccessToken(secret string) (string, error) {
	url := fmt.Sprintf("%s/gettoken?corpid=%s&corpsecret=%s", baseURL, corpID, secret)
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result struct {
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	json.Unmarshal(body, &result)
	if result.ErrCode != 0 {
		return "", fmt.Errorf("获取token失败: %d %s", result.ErrCode, result.ErrMsg)
	}
	return result.AccessToken, nil
}

func postJSON(url string, payload any) (map[string]any, error) {
	data, _ := json.Marshal(payload)
	resp, err := client.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result map[string]any
	json.Unmarshal(body, &result)
	return result, nil
}

func getJSON(url string) (map[string]any, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result map[string]any
	json.Unmarshal(body, &result)
	return result, nil
}

func printResult(title string, result map[string]any) {
	data, _ := json.MarshalIndent(result, "", "  ")
	fmt.Printf("\n═══ %s ═══\n%s\n", title, string(data))
}

func printSep() {
	fmt.Println("\n" + strings.Repeat("─", 60))
}

// ─── 测试用例 ───────────────────────────

// 测试1: 获取 access_token
func test1_GetTokens() (string, string) {
	fmt.Println("\n🔑 测试1: 获取 access_token")

	appToken, err := getAccessToken(corpSecret)
	if err != nil {
		log.Printf("  ❌ 应用 token 失败: %v", err)
	} else {
		fmt.Printf("  ✅ 应用 token: %s...(%d字符)\n", appToken[:20], len(appToken))
	}

	contactToken, err := getAccessToken(contactSecret)
	if err != nil {
		log.Printf("  ❌ 客户联系 token 失败: %v", err)
	} else {
		fmt.Printf("  ✅ 客户联系 token: %s...(%d字符)\n", contactToken[:20], len(contactToken))
	}

	return appToken, contactToken
}

// 测试2: 获取部门成员列表，找到刘浩东和吴泽华的 userid
func test2_FindEmployees(appToken string) (liuUserID, wuUserID string) {
	fmt.Println("\n👥 测试2: 查找员工 userid（刘浩东、吴泽华）")

	url := fmt.Sprintf("%s/user/list?access_token=%s&department_id=1&fetch_child=1", baseURL, appToken)
	result, err := getJSON(url)
	if err != nil {
		log.Printf("  ❌ 获取成员列表失败: %v", err)
		return
	}

	errCode, _ := result["errcode"].(float64)
	if errCode != 0 {
		printResult("获取成员列表失败", result)
		return
	}

	userList, ok := result["userlist"].([]any)
	if !ok {
		fmt.Println("  ❌ userlist 解析失败")
		return
	}

	fmt.Printf("  📋 共找到 %d 个成员:\n", len(userList))
	for _, u := range userList {
		user := u.(map[string]any)
		name, _ := user["name"].(string)
		userid, _ := user["userid"].(string)
		dept, _ := user["department"].([]any)
		status, _ := user["status"].(float64)
		fmt.Printf("    - %s (userid=%s, dept=%v, status=%.0f)\n", name, userid, dept, status)

		if strings.Contains(name, "刘浩东") || strings.Contains(name, "浩东") {
			liuUserID = userid
		}
		if strings.Contains(name, "吴泽华") || strings.Contains(name, "泽华") {
			wuUserID = userid
		}
	}

	if liuUserID != "" {
		fmt.Printf("  ✅ 刘浩东 userid: %s\n", liuUserID)
	} else {
		fmt.Println("  ⚠️ 未找到刘浩东")
	}
	if wuUserID != "" {
		fmt.Printf("  ✅ 吴泽华 userid: %s\n", wuUserID)
	} else {
		fmt.Println("  ⚠️ 未找到吴泽华")
	}

	return
}

// 测试3: 查找外部联系人（通过员工的外部联系人列表），找到 13226523959 对应的 external_userid
func test3_FindExternalContact(contactToken string, employeeUserIDs ...string) string {
	fmt.Println("\n📱 测试3: 查找外部联系人（手机号 " + testPhone + "）")

	for _, uid := range employeeUserIDs {
		if uid == "" {
			continue
		}
		fmt.Printf("  🔍 检查员工 %s 的外部联系人...\n", uid)

		url := fmt.Sprintf("%s/externalcontact/list?access_token=%s&userid=%s", baseURL, contactToken, uid)
		result, err := getJSON(url)
		if err != nil {
			log.Printf("    ❌ 请求失败: %v", err)
			continue
		}

		errCode, _ := result["errcode"].(float64)
		if errCode != 0 {
			fmt.Printf("    ⚠️ errcode=%.0f errmsg=%v\n", errCode, result["errmsg"])
			continue
		}

		externalUserIDs, ok := result["external_userid"].([]any)
		if !ok || len(externalUserIDs) == 0 {
			fmt.Printf("    📭 该员工没有外部联系人\n")
			continue
		}

		fmt.Printf("    📋 找到 %d 个外部联系人，逐个检查...\n", len(externalUserIDs))

		for _, eid := range externalUserIDs {
			externalUserID := eid.(string)

			detailURL := fmt.Sprintf("%s/externalcontact/get?access_token=%s&external_userid=%s", baseURL, contactToken, externalUserID)
			detail, err := getJSON(detailURL)
			if err != nil {
				continue
			}

			if ec, ok := detail["external_contact"].(map[string]any); ok {
				name, _ := ec["name"].(string)
				extUID, _ := ec["external_userid"].(string)
				gender, _ := ec["gender"].(float64)
				fmt.Printf("    - %s (gender=%.0f, external_userid=%s)\n", name, gender, extUID)

				// 检查 follow_user 中是否有手机号信息
				if followInfo, ok := detail["follow_user"].([]any); ok {
					for _, f := range followInfo {
						fu := f.(map[string]any)
						remark, _ := fu["remark"].(string)
						remarkMobiles, _ := fu["remark_mobiles"].([]any)
						if strings.Contains(remark, testPhone) {
							fmt.Printf("      ✅ 备注中包含手机号! external_userid=%s\n", extUID)
							return extUID
						}
						for _, m := range remarkMobiles {
							if mob, ok := m.(string); ok && mob == testPhone {
								fmt.Printf("      ✅ 备注手机匹配! external_userid=%s\n", extUID)
								return extUID
							}
						}
					}
				}
			}
		}
	}

	fmt.Println("  ℹ️ 未通过备注匹配到手机号，将使用第一个外部联系人做测试（如果有的话）")
	// 如果找不到精确匹配，返回空，后续测试跳过需要 external_userid 的用例
	return ""
}

// 测试4: 创建客户群（核心测试）
// 关键发现: groupchat/* 接口虽然路径是 /externalcontact/，但必须用【自建应用 Secret】的 token！
// 不能用客户联系 Secret 的 token（会报 48002）
func test4_CreateGroupChat(appToken, contactToken string, ownerUserID string, memberUserIDs []string, externalUserID string) string {
	fmt.Println("\n🏠 测试4: 创建客户群 (externalcontact/groupchat)")
	fmt.Println("  💡 关键: groupchat 接口虽在 /externalcontact/ 下，但必须用【自建应用 Secret】的 token!")

	if ownerUserID == "" {
		fmt.Println("  ⚠️ 无群主 userid，跳过")
		return ""
	}

	// 构建成员列表
	type Member struct {
		UserID string `json:"userid"`
		Type   int    `json:"type"` // 1=内部员工, 2=外部联系人
	}

	members := []Member{}
	members = append(members, Member{UserID: ownerUserID, Type: 1})
	for _, uid := range memberUserIDs {
		if uid != "" && uid != ownerUserID {
			members = append(members, Member{UserID: uid, Type: 1})
		}
	}

	hasExternal := externalUserID != ""
	if hasExternal {
		members = append(members, Member{UserID: externalUserID, Type: 2})
	}

	// 测试4a: 用【自建应用 token】调用 groupchat/create（正确做法）
	fmt.Println("  📝 4a: 用【自建应用 token】创建客户群（正确做法）")
	payload := map[string]any{
		"chat": map[string]any{
			"name":        "API测试群-AppToken",
			"owner":       ownerUserID,
			"member_list": members,
		},
	}
	urlApp := fmt.Sprintf("%s/externalcontact/groupchat/create?access_token=%s", baseURL, appToken)
	result, err := postJSON(urlApp, payload)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
	} else {
		printResult("4a 自建应用token创建结果", result)
		errCode, _ := result["errcode"].(float64)
		if errCode == 0 {
			chatID, _ := result["chat_id"].(string)
			fmt.Printf("  ✅ 4a 成功! chat_id=%s\n", chatID)
			return chatID
		}
		fmt.Printf("  ❌ 4a 失败 errcode=%.0f errmsg=%v\n", errCode, result["errmsg"])
	}

	// 测试4b: 用【客户联系 token】调用 groupchat/create（对比测试，预期失败 48002）
	fmt.Println("  📝 4b: 用【客户联系 token】创建客户群（对比测试，预期 48002）")
	urlContact := fmt.Sprintf("%s/externalcontact/groupchat/create?access_token=%s", baseURL, contactToken)
	result2, err := postJSON(urlContact, payload)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
	} else {
		printResult("4b 客户联系token创建结果", result2)
		errCode, _ := result2["errcode"].(float64)
		if errCode == 48002 {
			fmt.Println("  ✅ 符合预期! 客户联系 token 调 groupchat 果然报 48002")
		} else if errCode == 0 {
			chatID, _ := result2["chat_id"].(string)
			fmt.Printf("  🤔 意外成功 chat_id=%s\n", chatID)
			return chatID
		} else {
			fmt.Printf("  ❌ 4b errcode=%.0f\n", errCode)
		}
	}

	// 测试4c: 用自建应用token，仅内部员工创建客户群
	fmt.Println("  📝 4c: 用自建应用token，仅内部员工创建客户群")
	internalMembers := []Member{}
	for _, m := range members {
		if m.Type == 1 {
			internalMembers = append(internalMembers, m)
		}
	}
	payload3 := map[string]any{
		"chat": map[string]any{
			"name":        "API测试群-仅内部",
			"owner":       ownerUserID,
			"member_list": internalMembers,
		},
	}
	result3, err := postJSON(urlApp, payload3)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
	} else {
		printResult("4c 仅内部员工结果", result3)
		errCode, _ := result3["errcode"].(float64)
		if errCode == 0 {
			chatID, _ := result3["chat_id"].(string)
			fmt.Printf("  ✅ 4c 成功! chat_id=%s\n", chatID)
			return chatID
		}
		fmt.Printf("  ❌ 4c 失败 errcode=%.0f\n", errCode)
	}

	// 测试4d: 同时测试 groupchat/list 用自建应用token
	fmt.Println("  📝 4d: 用自建应用token获取客户群列表")
	listPayload := map[string]any{
		"status_filter": 0,
		"limit":         10,
	}
	listURL := fmt.Sprintf("%s/externalcontact/groupchat/list?access_token=%s", baseURL, appToken)
	result4, err := postJSON(listURL, listPayload)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
	} else {
		printResult("4d 客户群列表(自建应用token)", result4)
		errCode, _ := result4["errcode"].(float64)
		if errCode == 0 {
			fmt.Println("  ✅ 4d 获取客户群列表成功!")
		} else {
			fmt.Printf("  ❌ 4d 失败 errcode=%.0f\n", errCode)
		}
	}

	// 测试4e: 回退到内部群 appchat/create
	fmt.Println("  📝 4e: 回退测试内部群 appchat/create")
	internalIDs := []string{}
	for _, m := range members {
		if m.Type == 1 {
			internalIDs = append(internalIDs, m.UserID)
		}
	}
	payload5 := map[string]any{
		"name":     "API测试内部群",
		"owner":    ownerUserID,
		"userlist": internalIDs,
	}
	url5 := fmt.Sprintf("%s/appchat/create?access_token=%s", baseURL, appToken)
	result5, err := postJSON(url5, payload5)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
	} else {
		printResult("4e 内部群结果", result5)
		errCode, _ := result5["errcode"].(float64)
		if errCode == 0 {
			chatID, _ := result5["chatid"].(string)
			fmt.Printf("  ✅ 4e 内部群创建成功! chatid=%s\n", chatID)
		}
	}

	return ""
}

// 测试5: 在职转移客户
func test5_TransferCustomer(contactToken string, handoverUserID, takeoverUserID, externalUserID string) {
	fmt.Println("\n🔄 测试5: 在职转移客户")

	if handoverUserID == "" || takeoverUserID == "" || externalUserID == "" {
		fmt.Println("  ⚠️ 缺少必要参数，跳过转移测试")
		fmt.Printf("    handover=%s, takeover=%s, external=%s\n", handoverUserID, takeoverUserID, externalUserID)
		return
	}

	// 注意：这个操作会实际转移客户！先只做 dry-run 输出参数
	fmt.Println("  ⚠️ 转移客户是实际操作，先显示参数确认：")
	fmt.Printf("    原跟进人: %s\n", handoverUserID)
	fmt.Printf("    接替员工: %s\n", takeoverUserID)
	fmt.Printf("    客户: %s\n", externalUserID)
	fmt.Println("  ℹ️ 如需实际执行，请取消下方注释并重新运行")

	// 取消注释以实际执行转移：
	/*
		payload := map[string]any{
			"handover_userid":      handoverUserID,
			"takeover_userid":      takeoverUserID,
			"external_userid":      []string{externalUserID},
			"transfer_success_msg": "您好，我是您的专属跟单客服，后续由我为您服务~",
		}
		url := fmt.Sprintf("%s/externalcontact/transfer_customer?access_token=%s", baseURL, contactToken)
		result, err := postJSON(url, payload)
		if err != nil {
			log.Printf("  ❌ 请求失败: %v", err)
			return
		}
		printResult("转移客户结果", result)
	*/
}

// 测试6: 生成群活码
func test6_CreateJoinWay(contactToken string, chatID string) {
	fmt.Println("\n🔗 测试6: 生成群活码")

	if chatID == "" {
		fmt.Println("  ⚠️ 无群聊 ID，跳过")
		return
	}

	payload := map[string]any{
		"scene":   2, // 二维码
		"remark":  "API测试群活码",
		"state":   "test_order_001",
		"chat_id_list": []string{chatID},
	}

	url := fmt.Sprintf("%s/externalcontact/groupchat/add_join_way?access_token=%s", baseURL, contactToken)
	result, err := postJSON(url, payload)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
		return
	}
	printResult("群活码结果", result)

	errCode, _ := result["errcode"].(float64)
	if errCode == 0 {
		configID, _ := result["config_id"].(string)
		fmt.Printf("  ✅ 群活码创建成功! config_id=%s\n", configID)

		// 获取群活码详情（含二维码URL）
		detailPayload := map[string]any{
			"config_id": configID,
		}
		detailURL := fmt.Sprintf("%s/externalcontact/groupchat/get_join_way?access_token=%s", baseURL, contactToken)
		detail, err := postJSON(detailURL, detailPayload)
		if err == nil {
			printResult("群活码详情", detail)
			if joinWay, ok := detail["join_way"].(map[string]any); ok {
				if qrCode, ok := joinWay["qr_code"].(string); ok {
					fmt.Printf("  📷 二维码URL: %s\n", qrCode)
				}
			}
		}
	} else {
		fmt.Printf("  ❌ 群活码创建失败 errcode=%.0f\n", errCode)
	}
}

// 测试7: 群主转让
func test7_TransferGroupOwner(contactToken string, chatID, newOwnerUserID string) {
	fmt.Println("\n👑 测试7: 群主转让")

	if chatID == "" || newOwnerUserID == "" {
		fmt.Println("  ⚠️ 缺少参数，跳过")
		return
	}

	fmt.Printf("  ℹ️ 准备将群 %s 的群主转给 %s\n", chatID, newOwnerUserID)
	fmt.Println("  ⚠️ 群主转让是实际操作，先跳过。如需执行请取消注释。")

	// 取消注释以实际执行：
	/*
		payload := map[string]any{
			"chat_id_list": []string{chatID},
			"new_owner":    newOwnerUserID,
		}
		url := fmt.Sprintf("%s/externalcontact/groupchat/onjob_transfer?access_token=%s", baseURL, contactToken)
		result, err := postJSON(url, payload)
		if err != nil {
			log.Printf("  ❌ 请求失败: %v", err)
			return
		}
		printResult("群主转让结果", result)
	*/
}

// 测试8: 获取客户群详情（验证 chat_add_friend 字段）
func test8_GetGroupDetail(contactToken string, chatID string) {
	fmt.Println("\n📋 测试8: 获取客户群详情")

	if chatID == "" {
		fmt.Println("  ⚠️ 无群聊 ID，跳过")
		return
	}

	payload := map[string]any{
		"chat_id":   chatID,
		"need_name": 1,
	}

	url := fmt.Sprintf("%s/externalcontact/groupchat/get?access_token=%s", baseURL, contactToken)
	result, err := postJSON(url, payload)
	if err != nil {
		log.Printf("  ❌ 请求失败: %v", err)
		return
	}
	printResult("客户群详情", result)

	if gc, ok := result["group_chat"].(map[string]any); ok {
		chatAddFriend, exists := gc["chat_add_friend"]
		if exists {
			fmt.Printf("  ℹ️ chat_add_friend = %v (0=禁止互加, 1=允许)\n", chatAddFriend)
		} else {
			fmt.Println("  ℹ️ 返回中无 chat_add_friend 字段")
		}

		if members, ok := gc["member_list"].([]any); ok {
			fmt.Printf("  👥 群成员 %d 人:\n", len(members))
			for _, m := range members {
				member := m.(map[string]any)
				mType, _ := member["type"].(float64)
				uid, _ := member["userid"].(string)
				name, _ := member["name"].(string)
				typeStr := "内部"
				if mType == 2 {
					typeStr = "外部"
				}
				fmt.Printf("    - [%s] %s (%s)\n", typeStr, name, uid)
			}
		}
	}
}

func main() {
	fmt.Println("╔══════════════════════════════════════════════════╗")
	fmt.Println("║     企业微信 API 能力边界测试                      ║")
	fmt.Println("║     测试员工: 刘浩东、吴泽华                       ║")
	fmt.Println("║     测试外部: 13226523959                        ║")
	fmt.Println("╚══════════════════════════════════════════════════╝")

	// 检查命令行参数
	skipCreate := false
	for _, arg := range os.Args[1:] {
		if arg == "--skip-create" {
			skipCreate = true
		}
	}

	printSep()

	// 1. 获取 token
	appToken, contactToken := test1_GetTokens()
	if appToken == "" && contactToken == "" {
		log.Fatal("两个 token 都获取失败，无法继续测试")
	}

	printSep()

	// 2. 查找员工
	liuUserID, wuUserID := test2_FindEmployees(appToken)

	printSep()

	// 3. 查找外部联系人
	var externalUserID string
	searchUserIDs := []string{}
	if liuUserID != "" {
		searchUserIDs = append(searchUserIDs, liuUserID)
	}
	if wuUserID != "" {
		searchUserIDs = append(searchUserIDs, wuUserID)
	}
	if len(searchUserIDs) > 0 {
		externalUserID = test3_FindExternalContact(contactToken, searchUserIDs...)
	}

	printSep()

	// 4. 创建客户群（关键: groupchat接口要用自建应用token，不是客户联系token）
	var chatID string
	if !skipCreate {
		chatID = test4_CreateGroupChat(appToken, contactToken, liuUserID, []string{wuUserID}, externalUserID)
	} else {
		fmt.Println("\n⏭️ 跳过建群测试 (--skip-create)")
	}

	printSep()

	// 5. 转移客户测试（dry run）
	test5_TransferCustomer(contactToken, liuUserID, wuUserID, externalUserID)

	printSep()

	// 6. 群活码
	test6_CreateJoinWay(contactToken, chatID)

	printSep()

	// 7. 群主转让（dry run）
	test7_TransferGroupOwner(contactToken, chatID, wuUserID)

	printSep()

	// 8. 获取群详情
	test8_GetGroupDetail(contactToken, chatID)

	printSep()

	fmt.Println("\n📊 测试完成! 请查看以上结果判断 API 能力边界。")
	fmt.Println("ℹ️ 转移客户和群主转让默认为 dry-run，需要手动取消注释执行。")
}
