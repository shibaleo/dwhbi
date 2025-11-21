Zaim API Implementation Documentation
Overview
ZaimAPIクラスは、Zaim APIへのアクセスを提供します。OAuth 1.0a認証を使用して、取引データ、カテゴリ、ジャンル、口座情報などを取得できます。
Constructor
typescriptconstructor()
環境変数から以下の認証情報を読み込み、ZaimOAuthインスタンスを初期化します：

ZAIM_CONSUMER_KEY
ZAIM_CONSUMER_SECRET
ZAIM_ACCESS_TOKEN
ZAIM_ACCESS_TOKEN_SECRET

認証情報が不足している場合はエラーをスローします。

Methods
1. verifyUser()
typescriptasync verifyUser(): Promise<any>
説明: ユーザー情報を取得し、認証状態を確認します。
エンドポイント: GET /v2/home/user/verify
返り値:
typescript{
  me: {
    id: number,
    name: string,
    login: string,
    input_count: number,
    day_count: number,
    repeat_count: number,
    currency_code: string,
    created: string,
    profile_modified: string,
    profile_image_url: string,
    cover_image_url: string,
    // ... その他のフィールド
  },
  requested: number
}

2. getCategories()
typescriptasync getCategories(): Promise<{ categories: ZaimCategory[] }>
説明: カテゴリ一覧を取得します（例: Food, Items, Salary など）。
エンドポイント: GET /v2/home/category
返り値:
typescript{
  categories: [
    {
      id: number,           // カテゴリID
      name: string,         // カテゴリ名
      sort: number,         // 表示順序
      mode: "payment" | "income",  // 支出または収入
      active: number        // 有効フラグ（1=有効, 0=無効）
    }
  ]
}
サンプル:

{ id: 101, name: "Food", mode: "payment" }
{ id: 11, name: "Salary", mode: "income" }


3. getGenres()
typescriptasync getGenres(): Promise<{ genres: ZaimGenre[] }>
説明: ジャンル一覧を取得します（カテゴリの下位分類、例: Lunch, Dinner など）。
エンドポイント: GET /v2/home/genre
返り値:
typescript{
  genres: [
    {
      id: number,              // ジャンルID
      category_id: number,     // 親カテゴリID
      name: string,            // ジャンル名
      sort: number,            // 表示順序
      active: number,          // 有効フラグ
      parent_genre_id?: number // 親ジャンルID（サブジャンルの場合）
    }
  ]
}
サンプル:

{ id: 10104, category_id: 101, name: "Lunch" }
{ id: 10105, category_id: 101, name: "Dinner" }


4. getAccounts()
typescriptasync getAccounts(): Promise<{ accounts: ZaimAccount[] }>
説明: 口座一覧を取得します（例: WALLET, MOBILE SUICA など）。
エンドポイント: GET /v2/home/account
返り値:
typescript{
  accounts: [
    {
      id: number,     // 口座ID
      name: string,   // 口座名
      sort: number,   // 表示順序
      active: number  // 有効フラグ
    }
  ]
}
サンプル:

{ id: 19871604, name: "WALLET" }
{ id: 19871749, name: "MOBILE SUICA" }


5. getMoney()
typescriptasync getMoney(params?: {
  category_id?: number;
  genre_id?: number;
  mode?: "payment" | "income";
  start_date?: string;
  end_date?: string;
  page?: number;
  limit?: number;
}): Promise<{ money: ZaimTransaction[] }>
説明: 取引データを取得します。パラメータで絞り込み可能。
エンドポイント: GET /v2/home/money
パラメータ:

category_id: カテゴリIDで絞り込み
genre_id: ジャンルIDで絞り込み
mode: "payment"（支出）または"income"（収入）で絞り込み
start_date: 開始日（YYYY-MM-DD形式）
end_date: 終了日（YYYY-MM-DD形式）
page: ページ番号（ページネーション用）
limit: 取得件数の上限

返り値:
typescript{
  money: [
    {
      id: number,                        // 取引ID
      mode: "payment" | "income" | "transfer",  // 取引種別
      user_id: number,                   // ユーザーID
      date: string,                      // 日付（YYYY-MM-DD）
      category_id: number,               // カテゴリID
      genre_id: number,                  // ジャンルID
      from_account_id?: number,          // 支払元口座ID
      to_account_id?: number,            // 振込先口座ID
      amount: number,                    // 金額
      comment?: string,                  // コメント
      name?: string,                     // 品名
      place?: string,                    // 場所
      created?: string,                  // 作成日時
      modified?: string,                 // 更新日時
      active?: number,                   // 有効フラグ
      receipt_id?: number                // レシートID
    }
  ]
}
使用例:
typescript// 全取引取得
const allTransactions = await api.getMoney();

// 最近7日間の支出のみ取得
const recentPayments = await api.getMoney({
  mode: "payment",
  start_date: "2025-11-14",
  end_date: "2025-11-21",
  limit: 100
});

// 特定カテゴリの取引取得
const foodTransactions = await api.getMoney({
  category_id: 101  // Food
});

Base URL
すべてのエンドポイントは https://api.zaim.net/v2 をベースURLとして使用します。
認証
OAuth 1.0aを使用。各リクエストには署名が必要で、ZaimOAuthクラスが自動的に処理します。