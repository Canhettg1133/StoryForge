import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const FALLBACK_ROW_COUNT = 12;

const VirtualOutlineRow = React.memo(function VirtualOutlineRow({
  item,
  index,
  start,
  scrollMargin,
  measureElement,
  renderItem,
  rowGap,
}) {
  return (
    <div
      ref={measureElement}
      data-index={index}
      className="outline-virtual-row"
      style={{
        paddingBottom: `${rowGap}px`,
        transform: `translateY(${start - scrollMargin}px)`,
      }}
    >
      {renderItem(item, index)}
    </div>
  );
});

export function VirtualOutlineStack({
  className,
  items,
  estimateSize,
  renderItem,
  footer = null,
  overscan = 3,
  rowGap = 10,
  scrollElementMode = 'self',
}) {
  const [element, setElement] = useState(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const attachElement = useCallback((node) => setElement(node), []);
  const getScrollElement = useCallback(() => {
    if (!element) return null;
    if (scrollElementMode === 'ancestor') {
      return element.closest('.project-mobile-content') || element;
    }
    return element;
  }, [element, scrollElementMode]);
  const itemCount = items.length + (footer ? 1 : 0);

  useLayoutEffect(() => {
    if (!element || scrollElementMode !== 'ancestor') {
      setScrollMargin(0);
      return undefined;
    }
    const scrollElement = getScrollElement();
    if (!scrollElement || scrollElement === element) return undefined;
    const updateMargin = () => {
      const elementRect = element.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      setScrollMargin(elementRect.top - scrollRect.top + scrollElement.scrollTop);
    };
    updateMargin();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMargin);
    observer?.observe(element);
    observer?.observe(scrollElement);
    return () => observer?.disconnect();
  }, [element, getScrollElement, scrollElementMode]);

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement,
    getItemKey: (index) => (index < items.length ? items[index]?.id ?? index : 'outline-footer'),
    estimateSize: (index) => estimateSize(index < items.length ? items[index] : null, index) + rowGap,
    overscan,
    scrollMargin,
    initialRect: { width: 760, height: 700 },
  });
  const measuredItems = virtualizer.getVirtualItems();
  const virtualItems = measuredItems.length > 0
    ? measuredItems
    : Array.from({ length: Math.min(itemCount, FALLBACK_ROW_COUNT) }, (_, index) => ({
      index,
      key: index < items.length ? items[index]?.id ?? index : 'outline-footer',
      start: Array.from({ length: index }, (__, previousIndex) => (
        estimateSize(previousIndex < items.length ? items[previousIndex] : null, previousIndex) + rowGap
      )).reduce((total, size) => total + size, 0),
    }));
  const totalSize = virtualizer.getTotalSize() || virtualItems.reduce((total, item) => (
    Math.max(total, item.start + estimateSize(items[item.index] || null, item.index) + rowGap)
  ), 0);

  return (
    <div ref={attachElement} className={`${className} outline-virtual-collection`.trim()}>
      <div className="outline-virtual-content" style={{ height: `${totalSize}px` }}>
        {virtualItems.map((virtualItem) => {
          const isFooter = virtualItem.index >= items.length;
          return (
            <VirtualOutlineRow
              key={virtualItem.key}
              item={isFooter ? null : items[virtualItem.index]}
              index={virtualItem.index}
              start={virtualItem.start}
              scrollMargin={scrollElementMode === 'ancestor' ? scrollMargin : 0}
              measureElement={virtualizer.measureElement}
              renderItem={isFooter ? () => footer : renderItem}
              rowGap={rowGap}
            />
          );
        })}
      </div>
    </div>
  );
}

const VirtualOutlineGridRow = React.memo(function VirtualOutlineGridRow({
  items,
  rowIndex,
  start,
  scrollMargin,
  columnCount,
  columnGap,
  minColumnWidth,
  measureElement,
  renderItem,
  rowGap,
}) {
  const itemOffset = rowIndex * columnCount;
  return (
    <div
      ref={measureElement}
      data-index={rowIndex}
      className="outline-virtual-row outline-virtual-grid-row"
      style={{
        gap: `${columnGap}px`,
        gridTemplateColumns: `repeat(${columnCount}, minmax(${minColumnWidth}px, 1fr))`,
        paddingBottom: `${rowGap}px`,
        transform: `translateY(${start - scrollMargin}px)`,
      }}
    >
      {items.slice(itemOffset, itemOffset + columnCount).map((item, columnIndex) => (
        <React.Fragment key={item.id ?? itemOffset + columnIndex}>
          {renderItem(item, itemOffset + columnIndex)}
        </React.Fragment>
      ))}
    </div>
  );
});

export function VirtualOutlineGrid({
  className,
  items,
  minColumnWidth = 260,
  estimateSize,
  renderItem,
  overscan = 2,
  columnGap = 10,
  rowGap = 10,
  scrollElementMode = 'self',
}) {
  const [element, setElement] = useState(null);
  const [columnCount, setColumnCount] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);
  const attachElement = useCallback((node) => setElement(node), []);
  const getScrollElement = useCallback(() => {
    if (!element) return null;
    if (scrollElementMode === 'ancestor') {
      return element.closest('.project-mobile-content') || element;
    }
    return element;
  }, [element, scrollElementMode]);

  useLayoutEffect(() => {
    if (!element) return undefined;
    const updateColumns = () => {
      const width = element.clientWidth || element.getBoundingClientRect().width || 800;
      setColumnCount(Math.max(1, Math.floor((width + columnGap) / (minColumnWidth + columnGap))));
    };
    updateColumns();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateColumns);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [columnGap, element, minColumnWidth]);

  useLayoutEffect(() => {
    if (!element || scrollElementMode !== 'ancestor') {
      setScrollMargin(0);
      return undefined;
    }
    const scrollElement = getScrollElement();
    if (!scrollElement || scrollElement === element) return undefined;
    const updateMargin = () => {
      const elementRect = element.getBoundingClientRect();
      const scrollRect = scrollElement.getBoundingClientRect();
      setScrollMargin(elementRect.top - scrollRect.top + scrollElement.scrollTop);
    };
    updateMargin();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMargin);
    observer?.observe(element);
    observer?.observe(scrollElement);
    return () => observer?.disconnect();
  }, [element, getScrollElement, scrollElementMode]);

  const rowCount = Math.ceil(items.length / columnCount);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    getItemKey: (rowIndex) => items[rowIndex * columnCount]?.id ?? rowIndex,
    estimateSize: (rowIndex) => estimateSize(items[rowIndex * columnCount], rowIndex) + rowGap,
    overscan,
    scrollMargin,
    initialRect: { width: 800, height: 360 },
  });
  const measuredRows = virtualizer.getVirtualItems();
  const virtualRows = measuredRows.length > 0
    ? measuredRows
    : Array.from({ length: Math.min(rowCount, FALLBACK_ROW_COUNT) }, (_, rowIndex) => ({
      index: rowIndex,
      key: items[rowIndex * columnCount]?.id ?? rowIndex,
      start: Array.from({ length: rowIndex }, (__, previousRow) => (
        estimateSize(items[previousRow * columnCount], previousRow) + rowGap
      )).reduce((total, size) => total + size, 0),
    }));
  const totalSize = virtualizer.getTotalSize() || virtualRows.reduce((total, row) => (
    Math.max(total, row.start + estimateSize(items[row.index * columnCount], row.index) + rowGap)
  ), 0);

  return (
    <div ref={attachElement} className={`${className} outline-virtual-collection`.trim()}>
      <div className="outline-virtual-content" style={{ height: `${totalSize}px` }}>
        {virtualRows.map((virtualRow) => (
          <VirtualOutlineGridRow
            key={virtualRow.key}
            items={items}
            rowIndex={virtualRow.index}
            start={virtualRow.start}
            scrollMargin={scrollElementMode === 'ancestor' ? scrollMargin : 0}
            columnCount={columnCount}
            columnGap={columnGap}
            minColumnWidth={minColumnWidth}
            measureElement={virtualizer.measureElement}
            renderItem={renderItem}
            rowGap={rowGap}
          />
        ))}
      </div>
    </div>
  );
}
