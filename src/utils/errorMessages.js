const ACCENTED_VIETNAMESE_RE = /[À-ỹĐđ]/;

function getRawMessage(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return input.userMessage || input.message || '';
}

function hasVietnameseText(message) {
  return ACCENTED_VIETNAMESE_RE.test(String(message || ''));
}

function translateKnownError(message) {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();

  if (!raw) return '';

  if (lower.includes('openai_proxy_mixed_content_blocked') || lower.includes('mixed content')) {
    return 'Proxy URL đang dùng HTTP public. Trang HTTPS sẽ chặn Mixed Content. Hãy đổi Base URL sang HTTPS hoặc dùng endpoint HTTPS.';
  }

  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed') || lower.includes('network error')) {
    return 'Không thể kết nối mạng hoặc dịch vụ đang không phản hồi.';
  }

  const requestStatus = raw.match(/request failed:\s*(\d+)/i) || raw.match(/^status\s+(\d+)/i);
  if (requestStatus) {
    return `Yêu cầu thất bại với mã ${requestStatus[1]}.`;
  }

  if (lower.includes('unexpected json format') || lower.includes('malformed json response')) {
    return 'Phản hồi JSON không đúng định dạng.';
  }
  if (lower.includes('no json found')) {
    return 'Không tìm thấy JSON trong phản hồi.';
  }
  if (lower.includes('incomplete json')) {
    return 'Phản hồi JSON chưa hoàn chỉnh.';
  }
  if (lower.includes('invalid json body')) {
    return 'Nội dung JSON gửi lên không hợp lệ.';
  }

  if (lower.includes('ai canon extract returned empty response')) {
    return 'AI không trả về nội dung trích xuất canon.';
  }
  if (lower.includes('canon extract failed')) {
    return 'Không trích xuất được dữ liệu canon từ phản hồi AI.';
  }

  if (lower.includes('unsupported file type')) {
    return 'Định dạng file chưa được hỗ trợ.';
  }
  if (lower.includes('docx parser could not extract readable text')) {
    return 'Không trích xuất được văn bản đọc được từ file DOCX.';
  }
  if (lower.includes('pdf parser could not extract readable text')) {
    return 'Không trích xuất được văn bản đọc được từ file PDF.';
  }
  if (lower.includes('epub parser could not extract readable chapter content')) {
    return 'Không trích xuất được nội dung chương đọc được từ file EPUB.';
  }
  if (lower.includes('invalid epub: missing meta-inf/container.xml')) {
    return 'File EPUB không hợp lệ: thiếu META-INF/container.xml.';
  }
  if (lower.includes('invalid epub: missing package document path')) {
    return 'File EPUB không hợp lệ: thiếu đường dẫn package document.';
  }
  if (lower.includes('invalid epub: package document not found')) {
    return 'File EPUB không hợp lệ: không tìm thấy package document.';
  }
  if (lower.includes('invalid epub: failed to parse package document')) {
    return 'File EPUB không hợp lệ: không đọc được package document.';
  }

  if (lower.includes('missing database connection string')) {
    return 'Thiếu chuỗi kết nối database. Hãy cấu hình STORYFORGE_DATABASE_URL hoặc POSTGRES_URL.';
  }
  if (lower.includes('cloud snapshot not found')) {
    return 'Không tìm thấy snapshot cloud.';
  }
  if (lower.includes('missing snapshotjson')) {
    return 'Thiếu dữ liệu snapshotJson.';
  }
  if (lower.includes('cloud database initialization failed')) {
    return 'Không khởi tạo được database cloud.';
  }
  if (lower.includes('missing cloud sync credentials')) {
    return 'Thiếu thông tin đăng nhập Cloud Sync.';
  }
  if (lower.includes('missing projectslug')) {
    return 'Thiếu projectSlug.';
  }
  if (lower.includes('method not allowed')) {
    return 'Phương thức yêu cầu không được hỗ trợ.';
  }
  if (lower.includes('storage api not supported')) {
    return 'Trình duyệt chưa hỗ trợ Storage API.';
  }

  if (lower.includes('openai proxy relay failed')) {
    return 'Relay OpenAI proxy thất bại.';
  }
  if (lower.includes('supreme_provider_key_rejected')) {
    return 'API key AI lưu trên địa chỉ web này đã bị nhà cung cấp từ chối. Vào Settings để thay hoặc nhập lại key hợp lệ.';
  }
  if (lower.includes('unsupported proxy action')) {
    return 'Hành động proxy không được hỗ trợ.';
  }
  if (lower.includes('proxy url is required')) {
    return 'Cần nhập Proxy URL.';
  }
  if (lower.includes('proxy url must not contain spaces')) {
    return 'Proxy URL không được chứa khoảng trắng.';
  }
  if (lower.includes('proxy url must be an absolute http(s) url or a same-origin path')) {
    return 'Proxy URL phải là URL http(s) đầy đủ hoặc đường dẫn cùng origin.';
  }
  if (lower.includes('proxy url must use http or https')) {
    return 'Proxy URL phải dùng http hoặc https.';
  }

  if (lower.includes('oauth relay secret is not configured')) {
    return 'OAuth relay chưa cấu hình secret.';
  }
  if (lower.includes('missing oauth code')) {
    return 'Thiếu mã OAuth.';
  }
  if (lower.includes('oauth exchange failed')) {
    return 'Đổi mã OAuth thất bại.';
  }
  if (lower.includes('missing refresh token')) {
    return 'Thiếu refresh token.';
  }
  if (lower.includes('oauth refresh failed')) {
    return 'Làm mới OAuth thất bại.';
  }
  if (lower.includes('room not found')) {
    return 'Không tìm thấy room.';
  }
  if (lower === 'not found' || lower.includes('not found.')) {
    return 'Không tìm thấy dữ liệu.';
  }

  if (lower.includes('job not found')) {
    return 'Không tìm thấy job.';
  }
  if (lower.includes('job failed')) {
    return 'Job thất bại.';
  }
  if (lower.includes('job was cancelled') || lower.includes('job cancelled')) {
    return 'Job đã bị hủy.';
  }
  if (lower.includes('unknown processing error')) {
    return 'Lỗi xử lý chưa xác định.';
  }
  if (lower.includes('execution failed')) {
    return 'Quá trình thực thi thất bại.';
  }
  if (lower.includes('failed to create job')) {
    return 'Không tạo được job.';
  }
  if (lower.includes('inputdata is required and must be an object')) {
    return 'inputData là bắt buộc và phải là object.';
  }
  if (lower.includes('one or more dependency job ids do not exist')) {
    return 'Một hoặc nhiều job phụ thuộc không tồn tại.';
  }
  if (lower.includes('internal server error')) {
    return 'Lỗi máy chủ nội bộ.';
  }

  if (lower.includes('please choose a file')) {
    return 'Vui lòng chọn file.';
  }
  if (lower.includes('chapter not found')) {
    return 'Không tìm thấy chương.';
  }
  if (lower.includes('line number must be inside the selected chapter')) {
    return 'Số dòng phải nằm trong chương đã chọn.';
  }
  if (lower.includes('split would create an empty chapter')) {
    return 'Không thể tách vì sẽ tạo ra chương rỗng.';
  }

  if (lower.includes('corpusid is required')) {
    return 'Thiếu corpusId.';
  }
  if (lower.includes('projectid and analysisid are required')) {
    return 'Thiếu projectId hoặc analysisId.';
  }

  if (lower.includes('ai_studio_relay_url_required')) {
    return 'Thiếu URL AI Studio Relay.';
  }
  if (lower.includes('ai_studio_relay_room_required')) {
    return 'Thiếu mã room AI Studio Relay.';
  }
  if (lower.includes('unable to open ai studio relay socket')) {
    return 'Không mở được kết nối AI Studio Relay.';
  }
  if (lower.includes('relay message is too large')) {
    return 'Tin nhắn relay quá lớn.';
  }
  if (lower.includes('ai studio connector is not connected')) {
    return 'AI Studio Connector chưa kết nối.';
  }
  if (lower.includes('storyforge client is not connected')) {
    return 'StoryForge client chưa kết nối.';
  }

  if (lower.includes('job queue is full')) {
    return 'Hàng đợi job đã đầy. Hãy chờ bớt tác vụ rồi thử lại.';
  }
  if (lower.includes('execution cancelled by user')) {
    return 'Phiên chạy đã bị người dùng hủy.';
  }
  if (lower.includes('job started')) {
    return 'Job đã bắt đầu.';
  }
  if (lower.includes('job completed')) {
    return 'Job đã hoàn tất.';
  }
  if (lower.includes('job cancelled')) {
    return 'Job đã bị hủy.';
  }
  if (lower.includes('analysis cancelled')) {
    return 'Phiên phân tích đã bị hủy.';
  }

  if (lower.includes('scoped rerun requires corpusid and analysisid')) {
    return 'Chạy lại theo phạm vi cần có corpusId và analysisId.';
  }
  if (lower.includes('scoped rerun cancelled')) {
    return 'Lượt chạy lại theo phạm vi đã bị hủy.';
  }
  if (lower.includes('scoped rerun queued')) {
    return 'Đã xếp hàng lượt chạy lại theo phạm vi.';
  }
  if (lower.includes('scoped rerun completed')) {
    return 'Đã chạy lại theo phạm vi xong.';
  }
  if (lower.includes('loading analysis artifact for scoped rerun')) {
    return 'Đang tải artifact phân tích để chạy lại theo phạm vi.';
  }
  if (lower.includes('analysis already has an active rerun session')) {
    return 'Phân tích này đang có phiên chạy lại khác chưa hoàn tất.';
  }

  if (lower.includes('no element provided for export')) {
    return 'Chưa chọn nội dung để export.';
  }
  if (lower.includes('unknown format')) {
    return 'Định dạng export chưa được hỗ trợ.';
  }
  if (lower.includes('alias collision requires manual review')) {
    return 'Alias bị trùng, cần duyệt thủ công.';
  }

  return '';
}

export function toVietnameseErrorMessage(input, fallback = 'Đã xảy ra lỗi.') {
  const rawMessage = getRawMessage(input);
  const translated = translateKnownError(rawMessage);

  if (translated) return translated;
  if (rawMessage && hasVietnameseText(rawMessage)) return rawMessage;

  return fallback;
}
