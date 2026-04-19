import type { Locale } from "./config";

/** Flat UI strings; add keys for new copy. */
export type MessageKey =
  | "lang_en"
  | "lang_vi"
  | "common_language"
  | "common_loading"
  | "login_title"
  | "login_subtitle"
  | "login_email"
  | "login_password"
  | "login_error_credentials"
  | "login_reset_success"
  | "login_submit"
  | "login_submit_pending"
  | "login_no_account"
  | "login_create_one"
  | "login_forgot_password"
  | "forgot_password_title"
  | "forgot_password_subtitle"
  | "forgot_password_email"
  | "forgot_password_submit"
  | "forgot_password_submit_pending"
  | "forgot_password_back_to_login"
  | "forgot_password_contact_admin"
  | "forgot_password_admin_note"
  | "reset_password_title"
  | "reset_password_subtitle"
  | "reset_password_invalid"
  | "reset_password_new_password"
  | "reset_password_confirm_password"
  | "reset_password_submit"
  | "reset_password_submit_pending"
  | "reset_password_back_to_login"
  | "reset_password_request_new_link"
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
  login_title: "Welcome back",
  login_subtitle: "Sign in to NekoZeni with the email you used to register.",
  login_email: "Email",
  login_password: "Password",
  login_error_credentials: "Wrong email or password.",
  login_reset_success: "Password updated. Sign in with your new password.",
  login_submit: "Sign in",
  login_submit_pending: "Signing in…",
  login_no_account: "No account?",
  login_create_one: "Create one",
  login_forgot_password: "Forgot password?",
  forgot_password_title: "Reset your password",
  forgot_password_subtitle: "Enter your email and we will send you a password reset link.",
  forgot_password_email: "Email",
  forgot_password_submit: "Send reset link",
  forgot_password_submit_pending: "Sending reset link…",
  forgot_password_back_to_login: "Back to sign in",
  forgot_password_contact_admin: "To reset your password, contact the admin at",
  forgot_password_admin_note: "Password resets are handled manually right now.",
  reset_password_title: "Choose a new password",
  reset_password_subtitle: "Set a new password for your NekoZeni account.",
  reset_password_invalid: "This reset link is invalid or expired.",
  reset_password_new_password: "New password",
  reset_password_confirm_password: "Confirm new password",
  reset_password_submit: "Update password",
  reset_password_submit_pending: "Updating password…",
  reset_password_back_to_login: "Back to sign in",
  reset_password_request_new_link: "Request a new reset link",
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
  chat_account_aria: "Open account and profile: name, nickname, photo, password",
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
  login_title: "Chào mừng trở lại",
  login_subtitle: "Đăng nhập NekoZeni bằng email bạn đã đăng ký.",
  login_email: "Email",
  login_password: "Mật khẩu",
  login_error_credentials: "Email hoặc mật khẩu không đúng.",
  login_reset_success: "Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.",
  login_submit: "Đăng nhập",
  login_submit_pending: "Đang đăng nhập…",
  login_no_account: "Chưa có tài khoản?",
  login_create_one: "Tạo tài khoản",
  login_forgot_password: "Quên mật khẩu?",
  forgot_password_title: "Đặt lại mật khẩu",
  forgot_password_subtitle: "Nhập email của bạn và chúng tôi sẽ gửi liên kết đặt lại mật khẩu.",
  forgot_password_email: "Email",
  forgot_password_submit: "Gửi liên kết đặt lại",
  forgot_password_submit_pending: "Đang gửi liên kết…",
  forgot_password_back_to_login: "Quay lại đăng nhập",
  forgot_password_contact_admin: "Để đặt lại mật khẩu, hãy liên hệ quản trị viên tại",
  forgot_password_admin_note: "Hiện tại việc đặt lại mật khẩu được xử lý thủ công.",
  reset_password_title: "Chọn mật khẩu mới",
  reset_password_subtitle: "Đặt mật khẩu mới cho tài khoản NekoZeni của bạn.",
  reset_password_invalid: "Liên kết đặt lại này không hợp lệ hoặc đã hết hạn.",
  reset_password_new_password: "Mật khẩu mới",
  reset_password_confirm_password: "Xác nhận mật khẩu mới",
  reset_password_submit: "Cập nhật mật khẩu",
  reset_password_submit_pending: "Đang cập nhật mật khẩu…",
  reset_password_back_to_login: "Quay lại đăng nhập",
  reset_password_request_new_link: "Yêu cầu liên kết mới",
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
  chat_account_aria: "Mở tài khoản và hồ sơ: tên, biệt danh, ảnh, mật khẩu",
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
