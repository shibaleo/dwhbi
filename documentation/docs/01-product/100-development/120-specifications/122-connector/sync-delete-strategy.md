# Google Calendar 同期削除戦略

## 概要

Google Calendarで削除されたイベントをDBから削除し、Google Calendarを**Single Source of Truth（SSOT）**とする。

## 採用戦略

**Google Calendar API `showDeleted=true` + Hard Delete**

| 項目 | 値 |
|------|-----|
| APIパラメータ | `showDeleted=true` |
| 削除判定 | `status === "cancelled"` |
| 削除方式 | 物理削除（Hard Delete） |

## 処理フロー

```
Google Calendar API (showDeleted=true)
       │
       │ イベント取得（削除済み含む）
       ▼
┌─────────────────────┐
│  syncEvents()       │
│                     │
│  ┌───────────────┐  │
│  │ status分類    │  │
│  │ - confirmed   │──┼──► UPSERT
│  │ - cancelled   │──┼──► DELETE
│  └───────────────┘  │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ raw.google_calendar │
│ __events            │
│ (Google Calendarと  │
│  完全一致)          │
└─────────────────────┘
```

## 注意事項

### 同期範囲の制限

- デフォルト同期範囲（3日間）では、その期間内の削除のみ検出
- 過去の削除を反映するには、より広い範囲での同期が必要

### 繰り返しイベント

- `singleEvents=true`で各インスタンスを個別イベントとして取得
- 1インスタンスのみ削除 → そのインスタンスのみ`cancelled`
- 繰り返しルール自体の削除 → 全インスタンスが`cancelled`

## 関連ファイル

| ファイル | 変更内容 |
|---------|---------|
| `packages/connector/src/services/google-calendar/api-client.ts` | `showDeleted=true`追加 |
| `packages/connector/src/db/raw-client.ts` | `deleteBySourceIds()`関数追加 |
| `packages/connector/src/services/google-calendar/sync-events.ts` | status分類 + 削除ロジック |
