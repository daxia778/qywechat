package services

import (
	"testing"
)

func TestExtractFromRawText(t *testing.T) {
	tests := []struct {
		name       string
		text       string
		wantSN     string
		wantPrice  int
	}{
		{
			name:      "Standard Format",
			text:      "商品详情\n订单号：2403170012345678\n实付款：¥99.90\n商品：PPT制作设计",
			wantSN:    "2403170012345678",
			wantPrice: 9990,
		},
		{
			name:      "No Keywords Just Long Number",
			text:      "384759283746501239\n\n总计 150.00元",
			wantSN:    "384759283746501239",
			wantPrice: 15000,
		},
		{
			name:      "Space in text",
			text:      "订单编号: 5566778899001122\n应付金额 25.50元",
			wantSN:    "5566778899001122",
			wantPrice: 2550, 
		},
		{
			name:      "Empty Content",
			text:      "",
			wantSN:    "",
			wantPrice: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFromRawText(tt.text)
			if result.OrderSN != tt.wantSN {
				t.Errorf("extractFromRawText() OrderSN = %v, want %v", result.OrderSN, tt.wantSN)
			}
			if result.Price != tt.wantPrice {
				t.Errorf("extractFromRawText() Price = %v, want %v", result.Price, tt.wantPrice)
			}
		})
	}
}

func TestParseOCRJSON(t *testing.T) {
	// OCR JSON parser handles markdown-wrapped JSON blocks
	tests := []struct {
		name       string
		content    string
		wantSN     string
		wantPrice  int
	}{
		{
			name:      "Raw JSON",
			content:   `{"order_sn": "123456789012345", "price": "29.90"}`,
			wantSN:    "123456789012345",
			wantPrice: 2990,
		},
		{
			name:      "Markdown Wrapped JSON",
			content:   "```json\n{\n  \"order_sn\": \"987654321098765\",\n  \"price\": \"199.00\"\n}\n```",
			wantSN:    "987654321098765",
			wantPrice: 19900,
		},
		{
			name:      "Invalid JSON",
			content:   `not a json`,
			wantSN:    "", // returns nil normally, but the wrapper function checks for nil
			wantPrice: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseOCRJSON(tt.content)
			
			if tt.wantSN == "" {
				if result != nil {
					t.Errorf("parseOCRJSON() expected nil for invalid JSON")
				}
				return
			}
			
			if result == nil {
				t.Fatalf("parseOCRJSON() returned nil unexpectedly")
			}

			if result.OrderSN != tt.wantSN {
				t.Errorf("parseOCRJSON() OrderSN = %v, want %v", result.OrderSN, tt.wantSN)
			}
			if result.Price != tt.wantPrice {
				t.Errorf("parseOCRJSON() Price = %v, want %v", result.Price, tt.wantPrice)
			}
		})
	}
}
