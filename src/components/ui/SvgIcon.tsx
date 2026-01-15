import { useState, useEffect } from 'react';

interface SvgIconProps {
  src: string;
  className?: string;
  alt?: string;
}

export function SvgIcon({ src, className = '', alt }: SvgIconProps) {
  const [svgContent, setSvgContent] = useState<string | null>(null);

  useEffect(() => {
    fetch(src)
      .then(res => res.text())
      .then(text => {
        // Remove any XML declarations and just get the SVG
        const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
        if (svgMatch) {
          setSvgContent(svgMatch[0]);
        }
      })
      .catch(() => setSvgContent(null));
  }, [src]);

  if (!svgContent) {
    return <div className={className} aria-label={alt} />;
  }

  return (
    <div
      className={className}
      aria-label={alt}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
