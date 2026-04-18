import type { Locale } from "./config";

export type GuideSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type GuideContent = {
  title: string;
  lead: string;
  sections: GuideSection[];
};

const en: GuideContent = {
  title: "How to use NekoZeni",
  lead:
    "NekoZeni is a chat-first treasurer: talk to it like a message thread, attach receipts or paystubs, and it helps structure what you spent. Your data stays under your account.",
  sections: [
    {
      heading: "Basics after you sign in",
      paragraphs: [
        "The main screen is the chat. Type what you bought (store, amount, date) or use the paperclip to attach a photo or PDF.",
        "Send the message. The assistant reads your text and files, then replies with a short summary. If it saved a transaction to your ledger, it says so in the reply.",
        "Open Tools (top right) for wallets, categories, CSV import, backups, and to confirm repeating bills that need a quick yes/no.",
      ],
      bullets: [
        "Under Tools → Profile you can set language (English / Tiếng Việt), name, chat nickname, profile photo, and password — or tap your name in the chat header to open Profile. Tools → Plans is for spending budgets and savings goals the assistant can see in context.",
        "Images and PDFs you send are stored for your account (and included in a full ZIP backup under Tools → Backup).",
        "Large photos are automatically compressed to a clear JPEG when needed so uploads stay fast and storage-friendly.",
      ],
    },
    {
      heading: "Install as a phone app (PWA)",
      paragraphs: [
        "You don’t need an app store. NekoZeni is a Progressive Web App (PWA): install it from the browser and it opens like a native app from your home screen.",
      ],
      bullets: [
        "iPhone / iPad (Safari): open your NekoZeni site → tap the Share button → Add to Home Screen → Add. Launch NekoZeni from the new icon.",
        "Android (Chrome): open the site → tap the menu (⋮) → Install app, or Add to Home screen, depending on your Chrome version. Confirm install, then open from the launcher.",
        "Use the installed icon for the best experience: full screen, safe areas, and the system share sheet (below) target that app when you pick NekoZeni.",
      ],
    },
    {
      heading: "Share a photo from Camera or Gallery into NekoZeni",
      paragraphs: [
        "This uses the same “Share” flow as other apps. NekoZeni must already be installed from the home screen (recommended) or open in a tab where you are signed in.",
        "You should be logged in before sharing, so the import lands in your chat session.",
      ],
      bullets: [
        "iOS: take a photo in Camera, or open Photos → select the receipt image → Share → choose NekoZeni (or your browser’s share target that lists NekoZeni). If you don’t see it, install to Home Screen first, then try Share again.",
        "Android: open Google Photos or your Gallery → select the image → Share → pick NekoZeni / the browser PWA. Same tip: install the PWA first if the target is missing.",
        "After share: you’ll land in NekoZeni with the image attached to the composer and a short note in chat. Add any extra text, then tap Send so the assistant can read the receipt.",
      ],
    },
    {
      heading: "Tips",
      paragraphs: [],
      bullets: [
        "Receipts and Canadian paystub photos work best with good lighting and the full receipt in frame.",
        "Back up from Tools → Download ledger (JSON) for a small file, or Download full backup (ZIP) to include saved images for restore or your own archives.",
        "Language: in chat, tap your name or the account icon → Tools opens on Profile; use English / Tiếng Việt at the top of that panel. On sign-in, register, this guide, or onboarding, language is at the bottom of the form (not over other buttons).",
      ],
    },
  ],
};

const vi: GuideContent = {
  title: "Cách dùng NekoZeni",
  lead:
    "NekoZeni là trợ lý tài chính dạng chat: bạn nhắn như tin nhắn, đính kèm hóa đơn hoặc phiếu lương, ứng dụng giúp ghi nhận chi tiêu. Dữ liệu nằm trong tài khoản của bạn.",
  sections: [
    {
      heading: "Cơ bản sau khi đăng nhập",
      paragraphs: [
        "Màn hình chính là khung chat. Gõ mô tả mua hàng (cửa hàng, số tiền, ngày) hoặc bấm biểu tượng ghim để đính ảnh hoặc PDF.",
        "Gửi tin. Trợ lý đọc chữ và file, rồi trả lời ngắn. Nếu đã lưu giao dịch vào sổ, tin nhắn sẽ nói rõ.",
        "Mở Công cụ (góc trên bên phải) để quản lý ví, danh mục, nhập CSV, sao lưu, và xác nhận các khoản lặp lại cần bạn đồng ý nhanh.",
      ],
      bullets: [
        "Tại Công cụ → Hồ sơ bạn chọn ngôn ngữ (English / Tiếng Việt), đặt tên, biệt danh chat, ảnh đại diện và mật khẩu — hoặc chạm tên bạn trên thanh chat để mở Hồ sơ. Công cụ → Kế hoạch dùng cho ngân sách chi và mục tiêu tiết kiệm mà trợ lý thấy trong ngữ cảnh.",
        "Ảnh và PDF bạn gửi được lưu theo tài khoản (và nằm trong bản sao lưu ZIP đầy đủ tại Công cụ → Sao lưu).",
        "Ảnh lớn được nén tự động sang JPEG rõ nét khi cần để tải nhanh và tiết kiệm dung lượng.",
      ],
    },
    {
      heading: "Cài như ứng dụng trên điện thoại (PWA)",
      paragraphs: [
        "Không cần cửa hàng ứng dụng. NekoZeni là PWA: cài từ trình duyệt và mở giống app từ màn hình chính.",
      ],
      bullets: [
        "iPhone / iPad (Safari): mở trang NekoZeni → nút Chia sẻ → Thêm vào Màn hình chính → Thêm. Mở NekoZeni bằng biểu tượng mới.",
        "Android (Chrome): mở trang → menu (⋮) → Cài đặt ứng dụng hoặc Thêm vào Màn hình chính (tùy phiên bản). Xác nhận, rồi mở từ danh sách ứng dụng.",
        "Nên dùng biểu tượng đã cài để trải nghiệm tốt và để tính năng Chia sẻ của hệ thống nhận đúng NekoZeni.",
      ],
    },
    {
      heading: "Chia sẻ ảnh từ Máy ảnh hoặc Thư viện vào NekoZeni",
      paragraphs: [
        "Dùng luồng “Chia sẻ” giống các app khác. Nên cài NekoZeni từ màn hình chính, hoặc mở tab đã đăng nhập.",
        "Hãy đăng nhập trước khi chia sẻ để ảnh được đưa vào đúng phiên chat của bạn.",
      ],
      bullets: [
        "iOS: chụp trong Máy ảnh, hoặc Ảnh → chọn hình → Chia sẻ → chọn NekoZeni (hoặc mục chia sẻ của trình duyệt có NekoZeni). Nếu không thấy, cài Thêm vào Màn hình chính rồi thử lại.",
        "Android: Ảnh / Thư viện → chọn ảnh → Chia sẻ → NekoZeni / PWA trình duyệt. Cài PWA trước nếu chưa thấy mục.",
        "Sau khi chia sẻ: bạn vào NekoZeni với ảnh đã gắn sẵn ở ô soạn tin. Thêm chữ nếu cần, rồi bấm Gửi để trợ lý đọc hóa đơn.",
      ],
    },
    {
      heading: "Mẹo",
      paragraphs: [],
      bullets: [
        "Hóa đơn / phiếu lương Canada: chụp đủ sáng, thấy cả tờ trong khung.",
        "Sao lưu: Công cụ → Tải sổ (JSON) cho file nhỏ, hoặc Tải bản đầy đủ (ZIP) gồm cả ảnh đã lưu.",
        "Ngôn ngữ: trong chat, chạm tên hoặc biểu tượng tài khoản → mở Công cụ ở tab Hồ sơ; chọn English / Tiếng Việt ở đầu bảng. Trang đăng nhập, đăng ký, hướng dẫn hoặc bắt đầu: chọn ngôn ngữ ở cuối biểu mẫu (không che nút khác).",
      ],
    },
  ],
};

export function getGuideContent(locale: Locale): GuideContent {
  return locale === "vi" ? vi : en;
}
