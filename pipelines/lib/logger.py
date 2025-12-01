"""ロギング設定"""

import logging
import sys
from typing import Optional


def setup_logger(name: str, level: Optional[str] = None) -> logging.Logger:
    """ロガーをセットアップ

    Args:
        name: ロガー名
        level: ログレベル（DEBUG, INFO, WARNING, ERROR）

    Returns:
        設定済みロガー
    """
    logger = logging.getLogger(name)

    if level:
        logger.setLevel(getattr(logging, level.upper()))
    else:
        logger.setLevel(logging.INFO)

    # 既存のハンドラーを削除（重複防止）
    logger.handlers.clear()

    # コンソールハンドラー
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False  # 親ロガーへの伝播を防止

    return logger


# デフォルトロガー
default_logger = setup_logger("pipelines")


def info(message: str) -> None:
    """INFOレベルログ"""
    default_logger.info(message)


def error(message: str) -> None:
    """ERRORレベルログ"""
    default_logger.error(message)


def warning(message: str) -> None:
    """WARNINGレベルログ"""
    default_logger.warning(message)


def debug(message: str) -> None:
    """DEBUGレベルログ"""
    default_logger.debug(message)
