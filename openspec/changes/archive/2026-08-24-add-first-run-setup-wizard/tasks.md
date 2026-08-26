## 1. Profile and gate

- [x] 1.1 setup profile types / normalize / persist（`app.setupProfile`）
- [x] 1.2 shouldShowFirstRunSetup：unset vs legacy exempt vs reopen
- [x] 1.3 focused vitest for normalize / gate / complete / skip

## 2. Wizard UI

- [x] 2.1 FirstRunSetupWizard shell（steps、dots、返回、Enter）
- [x] 2.2 Welcome / IDE / Done
- [x] 2.3 CLI 卡片：detect、install、validate、skip
- [x] 2.4 极简 CSS + 主题 token + 产品 logo

## 3. Wiring

- [x] 3.1 AppRouter 主窗口挂 host
- [x] 3.2 IDE 选择写入 `selectedOpenAppId`；引擎写入 composer selection
- [x] 3.3 HomeChat soft banner
- [x] 3.4 Settings 重新运行入口
- [x] 3.5 IDEA preset + icon

## 4. i18n and verify

- [x] 4.1 zh / en `onboarding` critical pack
- [x] 4.2 settings rerun copy
- [x] 4.3 wizard / host / banner tests

## 5. Missing-engine install UX

- [x] 5.1 detect missing-binary 不得展示为卡片错误
- [x] 5.2 未安装文案 hover / 选中变成卡片内「安装」，移除外置按钮
- [x] 5.3 点击未安装卡片只选中并露出「安装」；点安装才开装；补 focused vitest

## 6. Selected engine summary

- [x] 6.1 Done / enter-app 以用户点选的已装引擎为准，不得被 detect 顺序回落到 Claude Code
- [x] 6.2 focused vitest：多引擎已装时选 DSH，完成页回显 DSH
