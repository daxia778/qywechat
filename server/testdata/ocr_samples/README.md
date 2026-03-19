# OCR 测试样本

本目录包含真实的 PDD 平台订单截图，用于 OCR 功能测试。

## 文件列表

| 文件 | 分辨率 | 说明 |
|:--|:--|:--|
| `pdd_order_sample_1.png` | 376×312 | PDD 订单详情截图 |
| `pdd_order_sample_2.png` | 380×360 | PDD 订单详情截图 |
| `pdd_order_sample_3.png` | 375×385 | PDD 订单详情截图 |

## 用法

### 手动测试 (curl)

```bash
# 获取 admin token
TOKEN=$(curl -s -X POST http://localhost:8200/api/v1/auth/admin_login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@2026"}' | jq -r '.token')

# 上传截图
curl -X POST http://localhost:8200/api/v1/orders/upload_ocr \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@pdd_order_sample_1.png"
```

### Go 集成测试

可以在 `handlers/order_handler_test.go` 中引用这些文件编写 OCR 集成测试。
