// zaim/types.ts

export interface ZaimTransaction {
  id: number;
  mode: "payment" | "income" | "transfer";
  user_id: number;
  date: string;
  category_id: number;
  genre_id: number;
  from_account_id?: number;
  to_account_id?: number;
  amount: number;
  comment?: string;
  name?: string;
  place?: string;
  created?: string;
  modified?: string;
  active?: number;
  receipt_id?: number;
}

export interface ZaimCategory {
  id: number;
  name: string;
  sort: number;
  mode: "payment" | "income";
  active: number;
}

export interface ZaimGenre {
  id: number;
  category_id: number;
  name: string;
  sort: number;
  active: number;
  parent_genre_id?: number;
}

export interface ZaimAccount {
  id: number;
  name: string;
  sort: number;
  active: number;
}

export interface OAuthConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}