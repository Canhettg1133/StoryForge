import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="route-state" aria-labelledby="not-found-title">
      <div className="route-state__panel">
        <h1 id="not-found-title">Không tìm thấy trang</h1>
        <p>Đường dẫn này không tồn tại hoặc đã được chuyển sang vị trí khác.</p>
        <Link className="btn btn-primary" to="/">Về trang dự án</Link>
      </div>
    </section>
  );
}
