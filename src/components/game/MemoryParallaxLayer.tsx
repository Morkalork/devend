import { useEffect, useRef, useCallback } from 'react';

/**
 * Memory Parallax Layer
 * 
 * A decorative layer representing abstract system memory activity.
 * Renders geometric shapes (blocks, bars) that allocate/deallocate
 * with parallax movement for depth.
 */

interface MemoryBlock {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'rect' | 'bar' | 'segment';
  opacity: number;
  targetOpacity: number;
  phase: 'allocating' | 'stable' | 'deallocating';
  lifetime: number;
  maxLifetime: number;
  parallaxFactor: number;
  segments?: number;
}

interface MemoryParallaxLayerProps {
  accentColor?: string;
}

const CONFIG = {
  maxBlocks: 20,
  spawnInterval: 800,
  minLifetime: 4000,
  maxLifetime: 12000,
  fadeSpeed: 0.02,
  parallaxRange: 0.15,
  baseOpacity: 0.08,
  maxOpacity: 0.15,
};

export function MemoryParallaxLayer({ accentColor = '#00ff88' }: MemoryParallaxLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blocksRef = useRef<MemoryBlock[]>([]);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const frameRef = useRef<number>(0);
  const lastSpawnRef = useRef<number>(0);
  const idCounterRef = useRef<number>(0);

  const createBlock = useCallback((): MemoryBlock => {
    const types: MemoryBlock['type'][] = ['rect', 'bar', 'segment'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    let width: number, height: number;
    
    switch (type) {
      case 'rect':
        width = 30 + Math.random() * 80;
        height = 8 + Math.random() * 20;
        break;
      case 'bar':
        width = 60 + Math.random() * 150;
        height = 2 + Math.random() * 4;
        break;
      case 'segment':
        width = 100 + Math.random() * 200;
        height = 6 + Math.random() * 12;
        break;
      default:
        width = 50;
        height = 10;
    }

    return {
      id: idCounterRef.current++,
      x: Math.random() * 100,
      y: Math.random() * 100,
      width,
      height,
      type,
      opacity: 0,
      targetOpacity: CONFIG.baseOpacity + Math.random() * (CONFIG.maxOpacity - CONFIG.baseOpacity),
      phase: 'allocating',
      lifetime: 0,
      maxLifetime: CONFIG.minLifetime + Math.random() * (CONFIG.maxLifetime - CONFIG.minLifetime),
      parallaxFactor: 0.5 + Math.random() * 1,
      segments: type === 'segment' ? 3 + Math.floor(Math.random() * 5) : undefined,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);
    handleResize();

    // Initial blocks
    for (let i = 0; i < 8; i++) {
      const block = createBlock();
      block.opacity = block.targetOpacity * 0.5;
      block.phase = 'stable';
      block.lifetime = block.maxLifetime * 0.3;
      blocksRef.current.push(block);
    }

    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      const dt = currentTime - lastTime;
      lastTime = currentTime;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn new blocks
      if (currentTime - lastSpawnRef.current > CONFIG.spawnInterval && blocksRef.current.length < CONFIG.maxBlocks) {
        blocksRef.current.push(createBlock());
        lastSpawnRef.current = currentTime;
      }

      // Update and render blocks
      blocksRef.current = blocksRef.current.filter(block => {
        block.lifetime += dt;

        // Phase transitions
        if (block.phase === 'allocating') {
          block.opacity += CONFIG.fadeSpeed;
          if (block.opacity >= block.targetOpacity) {
            block.opacity = block.targetOpacity;
            block.phase = 'stable';
          }
        } else if (block.phase === 'stable') {
          if (block.lifetime > block.maxLifetime * 0.7) {
            block.phase = 'deallocating';
          }
        } else if (block.phase === 'deallocating') {
          block.opacity -= CONFIG.fadeSpeed * 0.7;
          if (block.opacity <= 0) {
            return false; // Remove block
          }
        }

        // Parallax offset
        const parallaxX = (mouseRef.current.x - 0.5) * CONFIG.parallaxRange * block.parallaxFactor * canvas.width;
        const parallaxY = (mouseRef.current.y - 0.5) * CONFIG.parallaxRange * block.parallaxFactor * canvas.height;

        const screenX = (block.x / 100) * canvas.width + parallaxX;
        const screenY = (block.y / 100) * canvas.height + parallaxY;

        // Render based on type
        ctx.globalAlpha = block.opacity;
        
        // Parse accent color for rendering
        ctx.strokeStyle = accentColor;
        ctx.fillStyle = accentColor;

        switch (block.type) {
          case 'rect':
            ctx.strokeRect(screenX, screenY, block.width, block.height);
            // Small fill accent
            ctx.globalAlpha = block.opacity * 0.3;
            ctx.fillRect(screenX + 2, screenY + 2, block.width - 4, block.height - 4);
            break;

          case 'bar':
            ctx.lineWidth = block.height;
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(screenX + block.width, screenY);
            ctx.stroke();
            ctx.lineWidth = 1;
            break;

          case 'segment':
            if (block.segments) {
              const segWidth = block.width / block.segments;
              const gap = 4;
              for (let i = 0; i < block.segments; i++) {
                const segX = screenX + i * segWidth;
                // Alternate between filled and outline
                if (i % 2 === 0) {
                  ctx.globalAlpha = block.opacity * 0.5;
                  ctx.fillRect(segX, screenY, segWidth - gap, block.height);
                } else {
                  ctx.globalAlpha = block.opacity;
                  ctx.strokeRect(segX, screenY, segWidth - gap, block.height);
                }
              }
            }
            break;
        }

        return true;
      });

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, [accentColor, createBlock]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
      aria-hidden="true"
    />
  );
}
