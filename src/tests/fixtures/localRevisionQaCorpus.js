export const LOCAL_REVISION_QA_CORPUS = [
  {
    id: 'H01',
    styleBucket: 'synthetic_human_like',
    text: 'Chín giờ tối, bà Tư mới kéo cửa sắt xuống. Bà giữ lại một ngọn đèn cho Hòa, như mọi đêm.',
  },
  {
    id: 'H02',
    styleBucket: 'synthetic_human_like',
    text: '“Con về muộn.” Bà Thu đặt bát canh xuống bàn.\n\nHuy cởi áo mưa. “Xe con thủng lốp.”',
  },
  {
    id: 'H03',
    styleBucket: 'synthetic_human_like',
    text: 'Gió đổi chiều. Lâm cúi xuống. Một mũi tên cắm cạnh chân. Cậu lùi vào bóng cây.',
  },
  {
    id: 'H04',
    styleBucket: 'synthetic_human_like',
    text: 'Qua khung cửa mở hé, Hạnh nhìn thấy người đưa thư đặt chiếc phong bì màu nâu lên bậc đá, phủi giọt mưa khỏi vai áo rồi quay xe trước khi con chó già trong sân kịp sủa tiếng thứ hai.',
  },
  {
    id: 'H05',
    styleBucket: 'synthetic_human_like',
    text: 'Mưa gõ lên mái hiên. Mưa tràn qua rãnh ngói. Mưa xóa dấu chân người vừa rời ngõ.',
  },
  {
    id: 'H06',
    styleBucket: 'synthetic_human_like',
    text: 'Vy đặt chiếc nhẫn 💍 cạnh tách cà phê. Cô nhắn: ‘Đừng chờ mình nhé.’ rồi tắt màn hình.',
  },
  {
    id: 'H07',
    styleBucket: 'synthetic_human_like',
    text: 'Lan gọi Minh từ cuối sân. Minh quay lại, đưa chiếc chìa khóa cho Lan rồi tiếp tục xếp những thùng sách.',
  },
  {
    id: 'H08',
    styleBucket: 'synthetic_human_like',
    text: 'Con tàu rời bến khi sương còn mắc trên lan can. Dưới khoang, Phúc kiểm lại vé một lần nữa; đến tờ cuối cùng, anh mới nhận ra ghế số mười hai vẫn bỏ trống.',
  },
  {
    id: 'H09',
    styleBucket: 'synthetic_human_like',
    text: '— Anh đã khóa cửa chưa?\n\n— Rồi. Chìa khóa ở dưới chậu cây, đúng chỗ cũ.',
  },
  {
    id: 'H10',
    styleBucket: 'synthetic_human_like',
    text: 'Ông giáo gạch dưới cụm ‘mặt hồ phẳng như gương’ và bảo học trò rằng đôi khi một hình ảnh cũ vẫn đúng với ký ức của nhân vật.',
  },
  {
    id: 'A11',
    styleBucket: 'synthetic_ai_like',
    text: 'Không khí đặc quánh lại. Mọi người đều há hốc mồm kinh ngạc khi luồng sáng bùng lên giữa đại sảnh.',
  },
  {
    id: 'A12',
    styleBucket: 'synthetic_ai_like',
    text: 'Nam nhìn cánh cửa, nhìn chiếc khóa, rồi lại nhìn khe sáng dưới nền. Cậu nhìn mãi mà không bước tới.',
  },
  {
    id: 'A13',
    styleBucket: 'synthetic_ai_like',
    text: 'Cô không biết phải nói gì. Cô không biết phải nói gì. Cô không biết phải nói gì, nên chỉ cúi đầu.',
  },
  {
    id: 'A14',
    styleBucket: 'synthetic_ai_like',
    text: 'Đứng giữa quảng trường sau cơn mưa, Duy cố nhớ từng lời người gác cổng đã dặn từ tối qua, nhưng tiếng chuông từ tháp phía đông cứ dội xuống, đoàn xe chở thương binh vẫn nối nhau đi qua, những người bán hàng vội kéo bạt che quầy, còn đứa bé áo vàng ở bên kia đường liên tục chỉ về phía mái nhà nơi một vệt khói mỏng đang bốc lên mà không một ai chịu dừng lại để nhìn.',
  },
  {
    id: 'A15',
    styleBucket: 'synthetic_ai_like',
    text: 'Anh chạy. Anh ngã. Anh đứng. Anh thở. Anh nhìn.',
  },
  {
    id: 'A16',
    styleBucket: 'synthetic_ai_like',
    text: '“Đi đi.” Huy nói. “Tôi không đi.” Mai đáp. “Vậy ở lại.” Huy nói.',
  },
  {
    id: 'A17',
    styleBucket: 'synthetic_ai_like',
    text: '“Tôi sẽ quay lại trước bình minh, Mai nói rồi kéo cửa bước ra ngoài.',
  },
  {
    id: 'A18',
    styleBucket: 'synthetic_ai_like',
    text: 'Mai bước tới , nhìn cánh cửa  rồi hỏi : ‘Có ai ở đó không ?’',
  },
  {
    id: 'A19',
    styleBucket: 'synthetic_ai_like',
    text: 'Không thể nào!!! Anh đã nói rồi??? Vậy mà họ vẫn tiếp tục...',
  },
  {
    id: 'A20',
    styleBucket: 'synthetic_ai_like',
    text: 'Ở đầu hành lang, cánh cửa  khép lại sau lưng An. Ở cuối hành lang, cánh cửa  khép lại sau lưng Bình.',
  },
];

export function getLocalRevisionQaFixture(id) {
  return LOCAL_REVISION_QA_CORPUS.find((item) => item.id === id);
}
