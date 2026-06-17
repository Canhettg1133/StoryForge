import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';

export function resizeTextareaToContent(textarea) {
  if (!textarea || typeof window === 'undefined') return;

  textarea.style.height = 'auto';

  const computed = window.getComputedStyle(textarea);
  const maxHeight = Number.parseFloat(computed.maxHeight);
  const nextHeight = Number.isFinite(maxHeight) && maxHeight > 0
    ? Math.min(textarea.scrollHeight, maxHeight)
    : textarea.scrollHeight;

  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = Number.isFinite(maxHeight) && textarea.scrollHeight > maxHeight
    ? 'auto'
    : 'hidden';
}

const AutoResizeTextarea = forwardRef(function AutoResizeTextarea({
  className = '',
  onChange,
  value,
  ...props
}, forwardedRef) {
  const textareaRef = useRef(null);

  useImperativeHandle(forwardedRef, () => textareaRef.current, []);

  useLayoutEffect(() => {
    resizeTextareaToContent(textareaRef.current);
  }, [value]);

  const handleChange = (event) => {
    onChange?.(event);
    resizeTextareaToContent(event.currentTarget);
  };

  return (
    <textarea
      {...props}
      ref={textareaRef}
      className={`auto-resize-textarea ${className}`.trim()}
      value={value}
      onChange={handleChange}
    />
  );
});

export default AutoResizeTextarea;
