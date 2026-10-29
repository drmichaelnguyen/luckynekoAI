import type { Locale } from "./config";

/** Flat UI strings; add keys for new copy. */
export type MessageKey =
  | "lang_en"
  | "lang_vi"
  | "common_language"
  | "common_loading"
  | "profile_language_blurb"
  | "login_title"
  | "login_subtitle"
  | "login_email"
  | "login_password"
  | "login_error_credentials"
  | "login_submit"
  | "login_submit_pending"
  | "login_no_account"
  | "login_create_one"
  | "register_title"
  | "register_subtitle"
  | "register_email"
  | "register_password"
  | "register_password_hint"
  | "register_submit"
  | "register_submit_pending"
  | "register_has_account"
  | "register_sign_in"
  | "register_err_validation_email"
  | "register_err_validation_password"
  | "register_err_validation_default"
  | "register_err_auth_secret_missing"
  | "register_err_duplicate_email"
  | "register_err_create_failed"
  | "register_err_signin_autocreate_failed"
  | "register_err_signin_manual"
  | "guide_link_label"
  | "guide_link_aria"
  | "chat_account_title"
  | "chat_account_aria"
  | "chat_welcome"
  | "chat_mode_group_aria"
  | "chat_mode_record"
  | "chat_mode_ask"
  | "chat_mode_record_hint"
  | "chat_mode_ask_hint"
  | "chat_mode_record_title"
  | "chat_mode_ask_title"
  | "chat_placeholder_record"
  | "chat_placeholder_ask"
  | "daily_spend_checkin_body"
  | "daily_spend_checkin_hint"
  | "daily_spend_checkin_log"
  | "daily_spend_checkin_dismiss"
  | "daily_spend_checkin_aria"
  | "daily_spend_draft_prefix"
  | "voice_start_aria"
  | "voice_start_title"
  | "voice_stop_aria"
  | "voice_stop_title"
  | "voice_listening"
  | "voice_processing"
  | "voice_speaking"
  | "voice_unsupported_hint"
  | "voice_blocked_attachments";

const en: Record<MessageKey, string> = {
  lang_en: "English",
  lang_vi: "Tiếng Việt",
  common_language: "Language",
  common_loading: "Loading…",
  profile_language_blurb: "Applies across the app after you choose.",
  login_title: "Welcome back",
  login_subtitle: "Sign in to NekoZeni with the email you used to register.",
  login_email: "Email",
  login_password: "Password",
  login_error_credentials: "Wrong email or password.",
  login_submit: "Sign in",
  login_submit_pending: "Signing in…",
  login_no_account: "No account?",
  login_create_one: "Create one",
  register_title: "Create your account",
  register_subtitle:
    "One email, one password — your lucky cat treasurer stays private to you.",
  register_email: "Email",
  register_password: "Password",
  register_password_hint: "At least 8 characters",
  register_submit: "Create account",
  register_submit_pending: "Creating account…",
  register_has_account: "Already have an account?",
  register_sign_in: "Sign in",
  register_err_validation_email: "Enter a valid email address.",
  register_err_validation_password: "Password must be at least 8 characters.",
  register_err_validation_default: "Use a valid email and a password of at least 8 characters.",
  register_err_auth_secret_missing:
    "Sign-in is not configured (AUTH_SECRET is missing). Copy .env.example to .env, set AUTH_SECRET — for example run: openssl rand -base64 32 — then restart the dev server.",
  register_err_duplicate_email: "An account with this email already exists.",
  register_err_create_failed: "Could not create account. Try again.",
  register_err_signin_autocreate_failed:
    "Your account was created, but automatic sign-in failed. Open Sign in and log in with the same email and password.",
  register_err_signin_manual: "Account created — please sign in.",
  guide_link_label: "How to use · phone app · share photos",
  guide_link_aria: "Open the guide: using NekoZeni, install as an app, and share from the camera",
  chat_account_title: "Account & profile",
  chat_account_aria: "Open account settings: language, profile, name, photo, password",
  chat_welcome:
    "Hi — I’m NekoZeni, your little lucky-cat treasurer. Add records a new purchase, receipt, or paystub. Ask looks at what you’ve already saved — totals, categories, and plans — and does not write to your ledger. If a message doesn’t match the toggle, I’ll ask you to switch it.",
  chat_mode_group_aria: "Chat mode",
  chat_mode_record: "Add",
  chat_mode_ask: "Ask",
  chat_mode_record_hint: "Saves a new purchase, income, or receipt. Questions about what you already saved belong in Ask.",
  chat_mode_ask_hint: "Reads your ledger and answers. Nothing is saved. New purchases belong in Add.",
  chat_mode_record_title: "Add a new transaction",
  chat_mode_ask_title: "Ask about saved data",
  chat_placeholder_record: "What did you buy or get paid?",
  chat_placeholder_ask: "Ask about spending, totals, or plans…",
  daily_spend_checkin_body: "It's 10 PM or later — anything you'd like to log from today?",
  daily_spend_checkin_hint: "A quick note or receipt helps NekoZeni keep your ledger up to date.",
  daily_spend_checkin_log: "Log spending",
  daily_spend_checkin_dismiss: "Not today",
  daily_spend_checkin_aria: "Daily spending check-in",
  daily_spend_draft_prefix: "Today I spent:",
  voice_start_aria: "Start voice chat: speak, then listen to NekoZeni’s reply",
  voice_start_title: "Voice chat",
  voice_stop_aria: "Stop voice chat",
  voice_stop_title: "Stop voice",
  voice_listening: "Listening… speak when ready",
  voice_processing: "Working on that…",
  voice_speaking: "NekoZeni is speaking…",
  voice_unsupported_hint: "Voice needs Chrome or Safari (HTTPS).",
  voice_blocked_attachments: "Remove uploads to use voice.",
};

const vi: Record<MessageKey, string> = {
  lang_en: "English",
  lang_vi: "Tiếng Việt",
  common_language: "Ngôn ngữ",
  common_loading: "Đang tải…",
  profile_language_blurb: "Áp dụng cho toàn bộ ứng dụng sau khi bạn chọn.",
  login_title: "Chào mừng trở lại",
  login_subtitle: "Đăng nhập NekoZeni bằng email bạn đã đăng ký.",
  login_email: "Email",
  login_password: "Mật khẩu",
  login_error_credentials: "Email hoặc mật khẩu không đúng.",
  login_submit: "Đăng nhập",
  login_submit_pending: "Đang đăng nhập…",
  login_no_account: "Chưa có tài khoản?",
  login_create_one: "Tạo tài khoản",
  register_title: "Tạo tài khoản",
  register_subtitle: "Một email, một mật khẩu — kho bạc mèo may mắn chỉ dành riêng cho bạn.",
  register_email: "Email",
  register_password: "Mật khẩu",
  register_password_hint: "Ít nhất 8 ký tự",
  register_submit: "Tạo tài khoản",
  register_submit_pending: "Đang tạo tài khoản…",
  register_has_account: "Đã có tài khoản?",
  register_sign_in: "Đăng nhập",
  register_err_validation_email: "Nhập địa chỉ email hợp lệ.",
  register_err_validation_password: "Mật khẩu phải có ít nhất 8 ký tự.",
  register_err_validation_default: "Dùng email hợp lệ và mật khẩu ít nhất 8 ký tự.",
  register_err_auth_secret_missing:
    "Đăng nhập chưa được cấu hình (thiếu AUTH_SECRET). Sao chép .env.example thành .env, đặt AUTH_SECRET — ví dụ chạy: openssl rand -base64 32 — rồi khởi động lại máy chủ dev.",
  register_err_duplicate_email: "Email này đã được đăng ký.",
  register_err_create_failed: "Không tạo được tài khoản. Thử lại.",
  register_err_signin_autocreate_failed:
    "Tài khoản đã tạo nhưng đăng nhập tự động thất bại. Mở trang Đăng nhập và đăng nhập bằng cùng email và mật khẩu.",
  register_err_signin_manual: "Đã tạo tài khoản — vui lòng đăng nhập.",
  guide_link_label: "Cách dùng · cài trên điện thoại · chia sẻ ảnh",
  guide_link_aria: "Mở hướng dẫn: dùng NekoZeni, cài như app, chia sẻ từ máy ảnh",
  chat_account_title: "Tài khoản & hồ sơ",
  chat_account_aria: "Mở cài đặt tài khoản: ngôn ngữ, hồ sơ, tên, ảnh, mật khẩu",
  chat_welcome:
    "Chào bạn — mình là NekoZeni, thủ quỹ mèo may mắn. Thêm dùng để ghi khoản mua, hóa đơn hoặc phiếu lương mới. Hỏi dùng để xem dữ liệu đã lưu — tổng, danh mục, kế hoạch — và không ghi vào sổ. Nếu tin nhắn không khớp chế độ, mình sẽ nhờ bạn chuyển nút.",
  chat_mode_group_aria: "Chế độ chat",
  chat_mode_record: "Thêm",
  chat_mode_ask: "Hỏi",
  chat_mode_record_hint: "Lưu khoản mua, thu nhập hoặc hóa đơn mới. Hỏi về dữ liệu đã lưu thì chuyển sang Hỏi.",
  chat_mode_ask_hint: "Đọc sổ và trả lời. Không lưu gì. Muốn ghi giao dịch mới thì chuyển sang Thêm.",
  chat_mode_record_title: "Thêm giao dịch mới",
  chat_mode_ask_title: "Hỏi về dữ liệu đã lưu",
  chat_placeholder_record: "Bạn đã mua hoặc nhận gì?",
  chat_placeholder_ask: "Hỏi về chi tiêu, tổng, hoặc kế hoạch…",
  daily_spend_checkin_body: "Đã qua 22h — bạn có muốn ghi lại chi tiêu hôm nay không?",
  daily_spend_checkin_hint: "Một dòng ghi chú hoặc ảnh hóa đơn giúp NekoZeni cập nhật sổ chi.",
  daily_spend_checkin_log: "Ghi chi tiêu",
  daily_spend_checkin_dismiss: "Hôm nay thôi",
  daily_spend_checkin_aria: "Nhắc ghi chi tiêu cuối ngày",
  daily_spend_draft_prefix: "Hôm nay tôi đã chi:",
  voice_start_aria: "Bắt đầu chat giọng nói: nói, rồi nghe NekoZeni trả lời",
  voice_start_title: "Chat giọng nói",
  voice_stop_aria: "Dừng chat giọng nói",
  voice_stop_title: "Dừng giọng nói",
  voice_listening: "Đang nghe… hãy nói",
  voice_processing: "Đang xử lý…",
  voice_speaking: "NekoZeni đang nói…",
  voice_unsupported_hint: "Giọng nói cần Chrome hoặc Safari (HTTPS).",
  voice_blocked_attachments: "Gỡ tệp đính kèm để dùng giọng nói.",
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en, vi };

export function translate(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.en[key] ?? key;
}
