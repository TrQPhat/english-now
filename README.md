# TOEIC Practice Tests

Trang web tĩnh cho ba bộ đề TOEIC trong workspace. Nội dung đề được hiển thị từ
ảnh scan nguyên trang để giữ nguyên câu hỏi, hình ảnh, bảng biểu và đoạn văn;
đáp án được lưu riêng theo từng Part trong `data/test-xx.json`.

Cả ba đề đã có chế độ từng câu trong `data/test-01-structured.json`,
`data/test-02-structured.json` và `data/test-03-structured.json`.

## Chạy tại máy

```powershell
python -m http.server 4173
```

Mở `http://localhost:4173` trên trình duyệt.

## Quiz ôn tập xáo trộn

Mở `http://localhost:4173/practice.html` hoặc chọn **Ôn tập xáo trộn** trên
trang làm đề. Có thể chọn một hoặc nhiều Part; dữ liệu của cả ba đề được trộn
trong từng Part. Part 3, 4, 6 và 7 luôn được xáo theo nhóm, còn Part 1, 2 và 5
được xáo theo từng câu. Phiên đang làm được lưu trong trình duyệt.

Trong Part 2, nội dung các lựa chọn được ẩn khi làm bài nghe. Nút **Kiểm tra
đáp án** sẽ hiện đúng/sai và đáp án đúng trước khi cho phép chuyển sang nhóm
tiếp theo; trạng thái đã kiểm tra cũng được lưu cùng phiên.

Có thể mở trực tiếp một cấu hình bằng query, ví dụ `practice.html?parts=5` hoặc
`practice.html?parts=3,4,6`.

## Kiểm tra dữ liệu

```powershell
npm run validate
```

Validator kiểm tra đủ câu 1–200, không trùng số, đúng độ dài đáp án từng Part và
đủ tất cả ảnh trang đề.

## Tạo lại ảnh từ PDF

Môi trường OCR/xử lý PDF cục bộ đã được khai báo trong `requirements.txt`.

```powershell
.\.venv\Scripts\python.exe scripts\export_pages.py test-01.pdf public\assets\test-01
```
