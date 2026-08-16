まくら投げ戦術ボード PWA Ver.0.47

このフォルダはそのまま静的Webサイトとして公開できます。

【含まれるファイル】
index.html
manifest.webmanifest
sw.js
icons/
.nojekyll

【重要】
PWAのオフライン機能は、file:// で直接開くだけでは動きません。
HTTPSで公開したURL（例：GitHub Pages）から一度開いてください。

【iPhone / iPad】
1. 公開URLをSafariで開く
2. 共有ボタン
3. 「ホーム画面に追加」
4. 追加した「まくら戦術」から起動
5. 一度オンラインで起動した後は、アプリ本体はオフラインでも起動できます

【Mac】
公開URLをSafariで開いて使用できます。
対応OSではSafariの「Dockに追加」も利用できます。

【データ】
戦術・メンバー情報は現在ブラウザのlocalStorageに保存します。
そのためiPhone / iPad / Mac間で自動同期はまだされません。

【Ver.0.47】
セット編成10枠へ名前を直接入力。左の≡をドラッグすると、出場8枠＋控え2枠の名前をその場で交換できます。

【Ver.0.47】
・Googleログインを追加
・Firebase Cloud Firestoreで戦術とメンバーを同期
・同じGoogleアカウントでiPhone / iPad / Mac間同期
・FirestoreのWeb永続キャッシュを有効化
・初回ログイン時、クラウドが空なら端末データをアップロード、既存ならクラウドを優先
