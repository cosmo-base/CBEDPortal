# CBED Portal（CBED 運営ページ）

Cosmo Base Event Database（https://cbed.fsif.jp/ ）にイベント・ロケット打ち上げ情報を追加・編集するための運営向け管理画面です。

- 管理画面: **https://event.admin.fsif.jp/** （このリポジトリの Next.js アプリを静的エクスポートし GitHub Pages で公開）
- データ: 既存の Google スプレッドシート「CBED」の `シート1`（イベント）と `ロケット打上`
- API: Google Apps Script（コードは GitHub には置かず、GAS プロジェクト側で管理）
- サイト反映: GAS から [`cosmo-base/event_database`](https://github.com/cosmo-base/event_database) の GitHub Actions（`nextjs.yml`）を起動して再ビルド → `/{id}/` の個別ページが生成される

```
[event.admin.fsif.jp]  ──POST──▶  [GAS ウェブアプリ]  ──▶  スプレッドシート「CBED」
 (Next.js, GitHub Pages)                │
                                       └─(保存から10分後)─▶ GitHub Actions (event_database / nextjs.yml)
                                                              └─ 公開CSVを読んで next build → cbed.fsif.jp/{id}/
```

## できること

| 機能 | 内容 |
| --- | --- |
| URL・文章から入力 | URL を貼るとページの構造化データ（JSON-LD）・OGP・本文から、案内文を貼るとその文面から候補を作成。反映する項目を選べる |
| 新規登録 | 入力マニュアルの全項目に対応。ID は自動採番（最大ID+1）。イベント形式・対象レベルはシートの入力規則（プルダウン）から自動取得 |
| 追加日程 | 同じ内容で日付だけ違うイベントを、連番IDでまとめて登録 |
| 開催方法 | 現地／オンライン／ハイブリッド。オンラインは会場「オンライン」・形式に「オンライン」を付けて保存（地図には出ない） |
| 位置情報 | 「位置を取得」（GAS の Maps サービスでジオコーディング、都道府県も自動入力）／地図クリック／過去に登録した会場名を選ぶと自動入力 |
| 入力チェック | 必須項目・日付形式・緯度経度の範囲・プルダウン外の値をサーバー側でも検証。同じ日付・時間・タイトルの重複を警告 |
| リンク整形 | `utm_*` / `gclid` / `fbclid` などの計測パラメータを自動除去 |
| 一覧・編集 | 検索、過去分の表示切替、並び替え、形式・エリア・おすすめ・パートナーで絞り込み。編集（ID は変更不可、確認画面で変更点を表示）、複製して新規登録 |
| 打ち上げ情報 | `ロケット打上` シートの一覧・登録・編集。予定日は必須（空だとサイトのカレンダーが壊れるため）、時刻未定は「未定」で保存 |
| 同時編集対策 | 他の人が先に更新していた場合は保存を止めて再読み込みを促す |
| サイト反映 | 保存すると **10分後に自動ビルドを予約**（公開CSVの反映待ち。連続保存はまとめて1回）。手動ビルド、ビルド履歴の確認も可能 |
| 操作ログ | スプレッドシートに `管理ログ` シートを自動作成し、ログイン・登録・編集・ビルドを記録 |
| 下書き保存 | 新規登録の入力途中の内容をブラウザに自動保存 |

## セットアップ

### 1. 既存の GAS プロジェクトに API を追加する

CBED スプレッドシートにはすでに GAS（`onOpen` の「自動入力」メニュー、更新日時を入れる `onEdit`、`geocodeLocations`）があります。
**同じプロジェクトに別ファイルとして追加**します（関数名は重ならないようにしてあります）。スプレッドシートの編集権限を持つアカウントで作業します。

1. スプレッドシートの「拡張機能 → Apps Script」を開く
2. 「ファイル ＋ → スクリプト」で `管理API` を作り、運営で管理している API のコードを貼り付け（既存のコードはそのまま）
3. 「プロジェクトの設定」で「『appsscript.json』マニフェスト ファイルをエディタで表示する」をオンにし、`appsscript.json` に次を**追記**（既存の内容は消さない。`oauthScopes` は書かないこと。書くと既存メニューの権限が足りなくなります）

   ```json
   "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
   ```
4. 「プロジェクトの設定 → スクリプト プロパティ」に以下を追加

   | プロパティ | 必須 | 値 |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | ✅ | 管理画面のログインパスワード（長めのものを推奨） |
   | `GITHUB_TOKEN` | ✅ | 下記 2. で作る GitHub トークン |
   | `SPREADSHEET_ID` | | 既定: `1jl7DqMAcPN92p7RbMeLRE7RPuvea3j-lsAMSs8M1Xj4`（CBED） |
   | `SHEET_NAME` | | 既定: `シート1` |
   | `GITHUB_REPO` | | 既定: `cosmo-base/event_database` |
   | `GITHUB_WORKFLOW` | | 既定: `nextjs.yml` |
   | `GITHUB_REF` | | 既定: `main` |
   | `BUILD_DELAY_MIN` | | 既定: `10`（保存からビルド開始までの分数。公開CSVの反映に約5分かかるため5以上推奨） |

5. エディタで関数 `setupCheck` を選んで実行し、権限を承認。ログに「次のID」やプルダウンの候補が出れば OK
6. 「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
     （ページ自体はパスワードで保護。Google アカウント不要で呼び出せるようにするため）
   - 発行された `https://script.google.com/macros/s/…/exec` を控える

> コードを変更したら「デプロイを管理 → 編集 → バージョン: 新バージョン」で同じ URL のまま更新できます。

### 2. GitHub トークン（サイトの再ビルド用）

GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token

- Resource owner: `cosmo-base`
- Repository access: **Only select repositories** → `cosmo-base/event_database`
- Permissions → Repository permissions → **Actions: Read and write**（他は不要）

作成したトークンを GAS の `GITHUB_TOKEN` に設定します。期限切れになるとビルドが失敗するので、期限をメモしておいてください（失敗は `管理ログ` に `build-failed` として残ります）。

### 3. 管理画面を event.admin.fsif.jp で公開

1. このリポジトリの Settings → Secrets and variables → Actions → **Variables** に
   `GAS_API_URL` = 手順1で控えた `…/exec` の URL を登録（URL は秘密情報ではありませんが、API はパスワードで保護されています）
2. Settings → Pages → Source: **GitHub Actions**
3. `main` に push すると `.github/workflows/pages.yml` が `pnpm build`（静的エクスポート → `out/`）して公開
4. DNS（fsif.jp）に CNAME レコードを追加: `event.admin` → `cosmo-base.github.io`
5. Settings → Pages → Custom domain が `event.admin.fsif.jp` になっていることを確認し、「Enforce HTTPS」をオン

### 4. 動作確認

1. https://event.admin.fsif.jp/ に担当者名とパスワードでログイン
2. テスト用イベントを登録 → スプレッドシートの最終行に追加されることを確認
3. 「サイト反映」タブで自動ビルド予約時刻を確認 → ビルド成功後 `https://cbed.fsif.jp/{ID}/` が表示されることを確認
4. テスト行はスプレッドシートから削除し、もう一度ビルド

## ファイル構成

```
app/page.tsx           管理画面（ログイン・登録・一覧・詳細・確認・完了・サイト反映）
app/globals.css        スタイル
lib/api.ts             GAS との通信・セッション
lib/mapping.ts         シートの列 ⇔ フォーム項目の変換（時間・開催方法など）
lib/extract.ts         URL・文章からの入力候補づくり
lib/types.ts           型・都道府県・射場の一覧
public/CNAME           event.admin.fsif.jp
.github/workflows/pages.yml  Next.js をビルドして GitHub Pages に公開
```

### ローカルで動かす

```bash
cp .env.example .env.local   # NEXT_PUBLIC_GAS_API_URL を設定
pnpm install
pnpm dev
```

## 補足・注意

- スプレッドシートの 1 行目（ヘッダー）は列名で参照しているため、列の並び替えには対応していますが、**列名の変更はしないでください**。
- イベント形式に新しい種類を追加したいときは、スプレッドシート `type` 列の入力規則（プルダウン）に追加すれば、管理画面にも自動で表示されます。
- 書き込み先は「`id` か `title` が入っている最後の行の次の行」です（チェックボックスだけの空行は空行として扱います）。
- `更新日時` 列は、既存の `onEdit` と同じ `yyyy-MM-dd` 形式で登録・編集時に記録します（`onEdit` は手入力にしか反応しないため API 側で記録）。
- 同時編集は更新日時ではなく行の内容で検知するので、同じ日にシートを直接編集された場合も上書きを防げます。
- 管理画面で登録したイベントは緯度経度を入れて保存するので、既存の「自動入力」メニューを使う必要はありません（使っても空欄だけを埋めるので問題ありません）。
- 認証はパスワード + 6時間有効のセッショントークン（GAS の CacheService）です。10回連続で失敗すると10分間ログインできなくなります。
- `ロケット打上` シートには ID 列がないため、行番号を ID として扱います。編集時はタイトルが一致するか確認し、行がずれていたら保存を止めます。
- 「住所」はシートに列がないため保存されません（位置の取得にだけ使います）。
- 時間の欄が「開場18:30」のような自由記述の既存イベントは、時刻を入力し直さない限り元の表記のまま保存されます。
