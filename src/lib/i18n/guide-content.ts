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
    "NekoZeni is a chat-first treasurer: talk to it like a message thread, attach receipts, bills, or payroll documents, and it helps structure what you spent. Your data stays under your account.",
  sections: [
    {
      heading: "Basics after you sign in",
      paragraphs: [
        "The main screen is the chat. Type what you bought (store, amount, date) or use the paperclip to attach a photo or PDF.",
        "Send the message. The assistant reads your text and files, then replies with a short summary. If it saved a transaction to your ledger, it says so in the reply.",
        "Open Tools (top right) for wallets, categories, CSV import, backups, and to confirm repeating bills that need a quick yes/no.",
      ],
      bullets: [
        "Under Tools → Profile you can set your name, chat nickname, profile photo, and password. Tools → Plans is for spending budgets and savings goals the assistant can see in context.",
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
        "This uses your phone’s normal share sheet. Install NekoZeni to the home screen first, then make sure you have opened it once and signed in.",
        "If NekoZeni does not appear right away in the share sheet, scroll sideways, tap More, and enable it there. On some phones it may appear under your browser’s installed app targets instead of the first app row.",
      ],
      bullets: [
        "iPhone / iPad: Photos → select the receipt image → Share → look for NekoZeni. If it is not visible, swipe to the end of the app list → More → turn on NekoZeni, then try again.",
        "Android: Google Photos or Gallery → select the image → Share → look for NekoZeni. If it is missing, install the PWA first, then check the full share sheet or browser app targets.",
        "What happens next: NekoZeni opens with the image already attached above the message box. Add a note if you want, then tap Send to let the assistant read it.",
      ],
    },
    {
      heading: "Tips",
      paragraphs: [],
      bullets: [
        "Receipts, bills, and payroll photos from Canada or Vietnam work best with good lighting and the full page in frame.",
        "Back up from Tools → Download ledger (JSON) for a small file, or Download full backup (ZIP) to include saved images for restore or your own archives.",
        "Language: use English / Tiếng Việt from the switcher in the top corner (also before login).",
      ],
    },
  ],
};

const vi: GuideContent = {
  title: "Cách dùng NekoZeni",
  lead:
    "NekoZeni là trợ lý tài chính dạng chat: bạn nhắn như tin nhắn, đính kèm hóa đơn, chứng từ thanh toán hoặc phiếu lương, ứng dụng giúp ghi nhận chi tiêu. Dữ liệu nằm trong tài khoản của bạn.",
  sections: [
    {
      heading: "Cơ bản sau khi đăng nhập",
      paragraphs: [
        "Màn hình chính là khung chat. Gõ mô tả mua hàng (cửa hàng, số tiền, ngày) hoặc bấm biểu tượng ghim để đính ảnh hoặc PDF.",
        "Gửi tin. Trợ lý đọc chữ và file, rồi trả lời ngắn. Nếu đã lưu giao dịch vào sổ, tin nhắn sẽ nói rõ.",
        "Mở Công cụ (góc trên bên phải) để quản lý ví, danh mục, nhập CSV, sao lưu, và xác nhận các khoản lặp lại cần bạn đồng ý nhanh.",
      ],
      bullets: [
        "Tại Công cụ → Hồ sơ bạn đặt tên, biệt danh chat, ảnh đại diện và mật khẩu. Công cụ → Kế hoạch dùng cho ngân sách chi và mục tiêu tiết kiệm mà trợ lý thấy trong ngữ cảnh.",
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
        "Dùng bảng Chia sẻ của điện thoại như các app khác. Hãy cài NekoZeni ra màn hình chính trước, rồi mở app ít nhất một lần và đăng nhập.",
        "Nếu chưa thấy NekoZeni trong bảng Chia sẻ, hãy vuốt ngang, bấm Thêm, rồi bật NekoZeni. Trên một số máy, mục này nằm trong nhóm ứng dụng của trình duyệt/PWA chứ không hiện ngay hàng đầu.",
      ],
      bullets: [
        "iPhone / iPad: Ảnh → chọn hình hóa đơn → Chia sẻ → tìm NekoZeni. Nếu chưa thấy, vuốt đến cuối danh sách app → Thêm → bật NekoZeni rồi thử lại.",
        "Android: Google Photos / Thư viện → chọn ảnh → Chia sẻ → tìm NekoZeni. Nếu chưa có, hãy cài PWA trước rồi kiểm tra toàn bộ bảng chia sẻ hoặc nhóm app của trình duyệt.",
        "Sau khi chia sẻ: NekoZeni sẽ mở ra với ảnh đã đính kèm sẵn phía trên ô nhập. Bạn có thể thêm ghi chú rồi bấm Gửi để trợ lý đọc hóa đơn.",
      ],
    },
    {
      heading: "Mẹo",
      paragraphs: [],
      bullets: [
        "Hóa đơn, chứng từ thanh toán và phiếu lương ở Canada hoặc Việt Nam: chụp đủ sáng và thấy trọn trang trong khung.",
        "Sao lưu: Công cụ → Tải sổ (JSON) cho file nhỏ, hoặc Tải bản đầy đủ (ZIP) gồm cả ảnh đã lưu.",
        "Ngôn ngữ: chuyển English / Tiếng Việt ở góc trên (kể cả trước khi đăng nhập).",
      ],
    },
  ],
};

export function getGuideContent(locale: Locale): GuideContent {
  return locale === "vi" ? vi : en;
}
