import React, { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Plus, Save, Server, Trash2 } from 'lucide-react';
import keyManager from '../../services/ai/keyManager.js';
import {
  activateCustomOpenAIProxyPreset,
  getCustomOpenAIProxyPresetState,
  getSuggestedCustomOpenAIProxyPresetName,
  isCurrentCustomOpenAIProxyPresetDirty,
  removeCustomOpenAIProxyPreset,
  saveCurrentCustomOpenAIProxyPreset,
} from '../../services/ai/customOpenAIProxyPresets.js';
import { toVietnameseErrorMessage } from '../../utils/errorMessages.js';
import './CustomProxyPresetManager.css';

function getHostLabel(baseUrl) {
  try {
    return new URL(String(baseUrl || '').trim()).host || 'Chưa có URL';
  } catch {
    return String(baseUrl || '').trim() || 'Chưa có URL';
  }
}

export default function CustomProxyPresetManager({
  profile,
  keysRevision = 0,
  onActivated,
}) {
  const [presetState, setPresetState] = useState(getCustomOpenAIProxyPresetState);
  const [newPresetName, setNewPresetName] = useState(() => getSuggestedCustomOpenAIProxyPresetName(profile));
  const [feedback, setFeedback] = useState(null);
  const [pendingSwitchId, setPendingSwitchId] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState('');

  const activePreset = useMemo(
    () => presetState.presets.find((preset) => preset.id === presetState.activePresetId) || null,
    [presetState],
  );
  const isDirty = useMemo(
    () => isCurrentCustomOpenAIProxyPresetDirty(),
    [keysRevision, presetState, profile],
  );
  const keyCount = useMemo(
    () => keyManager.getKeyCount('openai_proxy'),
    [keysRevision],
  );

  useEffect(() => {
    if (!feedback) return undefined;
    const timeoutId = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  useEffect(() => {
    if (newPresetName.trim()) return;
    setNewPresetName(getSuggestedCustomOpenAIProxyPresetName(profile));
  }, [newPresetName, profile]);

  const refresh = () => setPresetState(getCustomOpenAIProxyPresetState());

  const validateCurrentSet = () => {
    if (!String(profile?.baseUrl || '').trim()) {
      setFeedback({ type: 'error', text: 'Nhập Base URL trước khi lưu bộ kết nối.' });
      return false;
    }
    if (profile?.requiresApiKey !== false && keyCount === 0) {
      setFeedback({ type: 'error', text: 'Thêm ít nhất một API key trước khi lưu bộ kết nối.' });
      return false;
    }
    return true;
  };

  const handleSaveNew = () => {
    if (!validateCurrentSet()) return;
    try {
      const saved = saveCurrentCustomOpenAIProxyPreset({ label: newPresetName });
      refresh();
      setNewPresetName('');
      setFeedback({ type: 'success', text: `Đã lưu bộ “${saved.label}” trên trình duyệt này.` });
    } catch (error) {
      setFeedback({ type: 'error', text: toVietnameseErrorMessage(error, 'Không thể lưu bộ kết nối.') });
    }
  };

  const handleUpdateActive = () => {
    if (!activePreset || !validateCurrentSet()) return;
    try {
      const saved = saveCurrentCustomOpenAIProxyPreset({
        id: activePreset.id,
        label: activePreset.label,
      });
      refresh();
      setFeedback({ type: 'success', text: `Đã cập nhật bộ “${saved.label}”.` });
    } catch (error) {
      setFeedback({ type: 'error', text: toVietnameseErrorMessage(error, 'Không thể cập nhật bộ kết nối.') });
    }
  };

  const activatePreset = (presetId) => {
    try {
      const activated = activateCustomOpenAIProxyPreset(presetId);
      setPendingSwitchId('');
      setPendingDeleteId('');
      refresh();
      onActivated?.(activated);
      setFeedback({ type: 'success', text: `Đang dùng bộ “${activated.preset.label}”.` });
    } catch (error) {
      setFeedback({ type: 'error', text: toVietnameseErrorMessage(error, 'Không thể chuyển bộ kết nối.') });
    }
  };

  const requestActivate = (presetId) => {
    if (presetId === presetState.activePresetId && !isDirty) return;
    if (isDirty && presetId !== presetState.activePresetId) {
      setPendingSwitchId(presetId);
      setPendingDeleteId('');
      return;
    }
    activatePreset(presetId);
  };

  const handleDelete = (presetId) => {
    if (pendingDeleteId !== presetId) {
      setPendingDeleteId(presetId);
      setPendingSwitchId('');
      return;
    }
    removeCustomOpenAIProxyPreset(presetId);
    setPendingDeleteId('');
    refresh();
    setFeedback({ type: 'success', text: 'Đã xóa bộ đã lưu. Cấu hình đang dùng không bị xóa.' });
  };

  return (
    <section className="custom-proxy-presets" aria-labelledby="custom-proxy-presets-title">
      <div className="custom-proxy-presets__header">
        <div>
          <h3 id="custom-proxy-presets-title">Các bộ kết nối đã lưu</h3>
          <p>URL, model và API key được giữ cùng nhau, chỉ trong trình duyệt này.</p>
        </div>
        <div className="custom-proxy-presets__current" data-dirty={isDirty ? 'true' : 'false'}>
          {activePreset ? activePreset.label : 'Bộ hiện tại chưa lưu'}
          {isDirty ? <span>Có thay đổi chưa lưu</span> : <span>Đã đồng bộ</span>}
        </div>
      </div>

      <div className="custom-proxy-presets__save-row">
        <label>
          <span>Tên bộ mới</span>
          <input
            className="input"
            value={newPresetName}
            onChange={(event) => setNewPresetName(event.target.value)}
            maxLength={80}
            placeholder={getSuggestedCustomOpenAIProxyPresetName(profile)}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={handleSaveNew}>
          <Plus size={15} /> Lưu thành bộ mới
        </button>
        {activePreset && isDirty ? (
          <button type="button" className="btn btn-secondary" onClick={handleUpdateActive}>
            <Save size={15} /> Cập nhật bộ đang dùng
          </button>
        ) : null}
      </div>

      {presetState.presets.length > 0 ? (
        <div className="custom-proxy-presets__list">
          {presetState.presets.map((preset) => {
            const isActive = preset.id === presetState.activePresetId;
            const isSwitchPending = pendingSwitchId === preset.id;
            const isDeletePending = pendingDeleteId === preset.id;
            return (
              <article
                className={`custom-proxy-preset ${isActive ? 'is-active' : ''}`}
                key={preset.id}
              >
                <div className="custom-proxy-preset__identity">
                  <span className="custom-proxy-preset__icon"><Server size={16} /></span>
                  <div>
                    <strong>{preset.label}</strong>
                    <span title={preset.profile.baseUrl}>{getHostLabel(preset.profile.baseUrl)}</span>
                  </div>
                </div>
                <div className="custom-proxy-preset__meta">
                  <span>{preset.profile.defaultModel || 'Chưa chọn model'}</span>
                  <span><KeyRound size={13} /> {preset.keys.length} key</span>
                  {isActive ? <span className="custom-proxy-preset__badge"><Check size={12} /> Đang dùng</span> : null}
                </div>
                <div className="custom-proxy-preset__actions">
                  {isSwitchPending ? (
                    <>
                      <span className="custom-proxy-preset__warning">Thay đổi hiện tại chưa được lưu.</span>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => activatePreset(preset.id)}>
                        Vẫn chuyển
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingSwitchId('')}>
                        Ở lại
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => requestActivate(preset.id)}
                      disabled={isActive && !isDirty}
                    >
                      {isActive ? 'Đang dùng' : 'Dùng bộ này'}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm ${isDeletePending ? 'is-danger' : ''}`}
                    onClick={() => handleDelete(preset.id)}
                    aria-label={isDeletePending ? `Xác nhận xóa ${preset.label}` : `Xóa ${preset.label}`}
                  >
                    <Trash2 size={14} /> {isDeletePending ? 'Xác nhận xóa' : 'Xóa'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="custom-proxy-presets__empty">
          Chưa có bộ nào. Cấu hình URL và key hiện tại, sau đó lưu thành bộ mới.
        </div>
      )}

      {feedback ? (
        <div className={`custom-proxy-presets__feedback is-${feedback.type}`} role="status">
          {feedback.text}
        </div>
      ) : null}
    </section>
  );
}
