import React, { useEffect, useState } from 'react';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_PUBLIC_SETUP_GUIDES,
  isExternalSetupGuideUrl,
} from '../../../packages/access/src/setupGuides.js';
import { getSetupGuides } from './setupGuidesClient.js';

function cloneDefaultItems() {
  return DEFAULT_PUBLIC_SETUP_GUIDES.items.map((item) => ({ ...item }));
}

function GuideIcon({ name }) {
  const Icon = name === 'external' ? ExternalLink : BookOpen;
  return <Icon size={14} aria-hidden="true" />;
}

export default function SetupGuideButtons() {
  const [items, setItems] = useState(cloneDefaultItems);

  useEffect(() => {
    let cancelled = false;
    getSetupGuides().then((config) => {
      if (!cancelled) setItems(config.items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="settings-action-row" aria-label="Hướng dẫn thiết lập Gemini">
      {items.map((item, index) => {
        const className = `btn setup-guide-button ${index === 0 ? 'btn-primary' : 'btn-secondary'}`;
        const content = (
          <>
            <GuideIcon name={item.icon} />
            {item.label}
          </>
        );

        if (isExternalSetupGuideUrl(item.url)) {
          return (
            <a
              key={item.id}
              className={className}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content}
            </a>
          );
        }

        return (
          <Link key={item.id} className={className} to={item.url}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}


