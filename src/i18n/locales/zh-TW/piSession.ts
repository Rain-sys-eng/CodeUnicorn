export default {
  piSession: {
    fork: {
      title: "從這則訊息分岔",
      description:
        "將回到該訊息之前的點建立新會話檔案：以該訊息為草稿重寫，來源會話保持不變。新分支會出現在會話樹面板（不佔側欄），建立後自動跳轉繼續。",
      cancel: "取消",
      confirm: "建立分岔",
      confirming: "分岔中…",
      successTitle: "✓ 分岔已建立",
      successBody:
        "新分支已出現在右側會話樹面板，來源訊息已填入它的輸入框草稿，跳轉即可繼續。",
      errorEntryNotFound:
        "無法在 pi 會話中定位這則訊息（可能已被壓縮）。",
      errorEntryNotForkable:
        "這則訊息不在目前的會話檔案裡——它屬於會話樹中的另一條分支（或已被壓縮），無法從這裡直接分岔。請先在會話樹中「↪ 跳轉」到這則訊息所在的分支，再對它分岔。",
    },
  },
};
