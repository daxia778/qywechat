package main

/*
#cgo darwin LDFLAGS: -framework UniformTypeIdentifiers
*/
import "C"

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "PDD 派单助手",
		Width:     420,
		Height:    680,
		MinWidth:  380,
		MinHeight: 600,
		MaxWidth:  500,
		MaxHeight: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 15, B: 25, A: 255},
		OnStartup:        app.startup,
		AlwaysOnTop:      false,
		Frameless:        false,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar: &mac.TitleBar{
				TitlebarAppearsTransparent: true,
				HideTitle:                 true,
				FullSizeContent:           true,
			},
			Appearance: mac.NSAppearanceNameDarkAqua,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
