"""Google Calendar API 同期モジュール

Google Calendar API v3 を使用してイベント・カラー・カレンダーリストを取得し、
raw層にJSONB形式で保存する。

モジュール構成:
- api_client.py: OAuth認証・API呼び出し
- sync_events.py: イベント同期
- sync_masters.py: カラー・カレンダーリスト・カレンダー同期
- orchestrator.py: 統合オーケストレーター
"""

from pipelines.services.google_calendar.orchestrator import sync_all

__all__ = ["sync_all"]
