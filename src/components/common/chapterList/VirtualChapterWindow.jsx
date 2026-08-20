import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export const VirtualChapterRow = React.memo(function VirtualChapterRow({
  item,
  index,
  start,
  rowClassName,
  measureElement,
  renderItem,
}) {
  return (
    <div
      ref={measureElement}
      data-index={index}
      className={`chapter-virtual-row ${rowClassName}`.trim()}
      style={{ transform: `translateY(${start}px)` }}
    >
      {renderItem(item, index)}
    </div>
  );
});

export default function VirtualChapterWindow({
  className,
  items,
  scrollRef,
  estimateSize,
  overscan = 4,
  measurementKey,
  activeItemId,
  rowClassName = '',
  renderItem,
}) {
  const [scrollElement, setScrollElement] = useState(null);
  const lastScrolledItemIdRef = useRef(null);
  const attachScrollElement = useCallback((element) => {
    scrollRef.current = element;
    setScrollElement(element);
  }, [scrollRef]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => items[index]?.id ?? index,
    estimateSize,
    overscan,
    initialRect: { width: 280, height: 800 },
    measureElement: (element) => {
      const measured = element.getBoundingClientRect().height;
      const index = Number(element.dataset.index);
      return measured > 0 ? measured : estimateSize(index);
    },
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [measurementKey, virtualizer]);

  useLayoutEffect(() => {
    if (activeItemId == null) return;
    const index = items.findIndex((item) => item.id === activeItemId);
    if (index >= 0 && lastScrolledItemIdRef.current !== activeItemId) {
      virtualizer.scrollToIndex(index, { align: 'auto' });
      lastScrolledItemIdRef.current = activeItemId;
    }
  }, [activeItemId, items, virtualizer]);

  const measuredVirtualItems = virtualizer.getVirtualItems();
  const virtualItems = measuredVirtualItems.length > 0
    ? measuredVirtualItems
    : items.slice(0, Math.min(12, (overscan * 2) + 6)).map((item, index) => {
      let start = 0;
      for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
        start += estimateSize(previousIndex);
      }
      return {
        index,
        key: item.id ?? index,
        start,
      };
    });
  const totalSize = virtualizer.getTotalSize()
    || items.reduce((total, _item, index) => total + estimateSize(index), 0);

  return (
    <div ref={attachScrollElement} className={className}>
      <div
        className="chapter-virtual-window"
        style={{ height: `${totalSize}px` }}
      >
        {virtualItems.map((virtualItem) => (
          <VirtualChapterRow
            key={virtualItem.key}
            item={items[virtualItem.index]}
            index={virtualItem.index}
            start={virtualItem.start}
            rowClassName={rowClassName}
            measureElement={virtualizer.measureElement}
            renderItem={renderItem}
          />
        ))}
      </div>
    </div>
  );
}
