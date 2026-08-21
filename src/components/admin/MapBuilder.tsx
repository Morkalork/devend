import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Plus, Save, Trash2, Download, Copy, Check, AlertCircle } from 'lucide-react';
import { AreaKind, ColoredArea, LevelConfig, BallConfig, LevelEntity, WallRectEntity, WallCircleEntity, WallPolygonEntity, GravityWell } from '@/types/level';
import { makeColoredArea } from '@/lib/coloredAreas';
import { MapCanvas } from './MapCanvas';
import { EntityPanel } from './EntityPanel';
import { LevelPanel } from './LevelPanel';
import yaml from 'js-yaml';

interface MapBuilderProps {
  onBack: () => void;
}

export function MapBuilder({ onBack }: MapBuilderProps) {
  const [levels, setLevels] = useState<LevelConfig[]>([]);
  const [selectedLevelIndex, setSelectedLevelIndex] = useState<number>(0);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedBallId, setSelectedBallId] = useState<string | null>(null);
  // Colored Areas have no id in the schema, so selection is by index.
  const [selectedAreaIndex, setSelectedAreaIndex] = useState<number | null>(null);
  const [selectedWellIndex, setSelectedWellIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // Copy/paste clipboard for objects (walls or balls). Ctrl+C fills it from the
  // current selection, Ctrl+V pastes an offset copy into the current level, so a
  // copy can also be pasted onto a different level.
  const clipboardRef = useRef<
    | { kind: 'entity'; data: LevelEntity }
    | { kind: 'ball'; data: BallConfig }
    | null
  >(null);

  // Load levels from map.yml
  useEffect(() => {
    const loadLevels = async () => {
      try {
        const response = await fetch('/map.yml', { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to load map.yml');
        const text = await response.text();
        const data = yaml.load(text) as { levels: LevelConfig[] };
        if (!data?.levels || !Array.isArray(data.levels)) {
          throw new Error('Invalid map.yml structure');
        }
        // Issue #37: gameplay no longer stores per-ball configs in map.yml (the
        // game picks ball types from maxBalls). Normalise legacy/missing `balls`
        // to an empty array so the (dev-only) builder UI keeps working.
        setLevels(data.levels.map(l => ({ ...l, balls: l.balls ?? [] })));
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load levels');
        setIsLoading(false);
      }
    };
    loadLevels();
  }, []);

  const currentLevel = levels[selectedLevelIndex] || null;

  // Update level in state
  const updateLevel = useCallback((updatedLevel: LevelConfig) => {
    setLevels(prev => prev.map((l, i) => 
      i === selectedLevelIndex ? updatedLevel : l
    ));
  }, [selectedLevelIndex]);

  // Create new level
  const createNewLevel = useCallback(() => {
    const newLevel: LevelConfig = {
      id: `level-${levels.length + 1}`,
      level: levels.length + 1,
      sizeThreshold: 40,
      expectedCuts: 5,
      points: 100,
      balls: [{
        id: 'ball-1',
        initialSpeed: 300,
        topSpeed: 600,
        color: '00ff88',
      }],
      entities: [],
    };
    setLevels(prev => [...prev, newLevel]);
    setSelectedLevelIndex(levels.length);
  }, [levels.length]);

  // Delete current level
  const deleteLevel = useCallback(() => {
    if (levels.length <= 1) return;
    setLevels(prev => prev.filter((_, i) => i !== selectedLevelIndex));
    setSelectedLevelIndex(Math.max(0, selectedLevelIndex - 1));
  }, [levels.length, selectedLevelIndex]);

  // Duplicate level with suffix (4 → 4b, 4b → 4c, etc.)
  const duplicateLevel = useCallback((index: number) => {
    const source = levels[index];
    if (!source) return;

    // Parse base id and find next available suffix
    const baseMatch = source.id.match(/^(level-\d+)([a-z]?)$/);
    const baseId = baseMatch ? baseMatch[1] : source.id;

    // Collect existing suffixes for this base
    const existingSuffixes = new Set(
      levels
        .map(l => {
          const m = l.id.match(new RegExp(`^${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([a-z]?)$`));
          return m ? (m[1] || '') : null;
        })
        .filter((s): s is string => s !== null)
    );

    // Find next suffix: '' → 'b', 'b' → 'c', etc.
    let nextSuffix = 'b';
    while (existingSuffixes.has(nextSuffix)) {
      nextSuffix = String.fromCharCode(nextSuffix.charCodeAt(0) + 1);
    }

    const newLevel: LevelConfig = JSON.parse(JSON.stringify(source));
    newLevel.id = `${baseId}${nextSuffix}`;

    // Insert right after the source level
    setLevels(prev => [
      ...prev.slice(0, index + 1),
      newLevel,
      ...prev.slice(index + 1),
    ]);
    setSelectedLevelIndex(index + 1);
    setSelectedEntityId(null);
    setSelectedBallId(null);
    setSelectedAreaIndex(null);
  }, [levels]);

  // Add entity (obstacle)
  const addEntity = useCallback((type: 'circle' | 'polygon' | 'rect') => {
    if (!currentLevel) return;

    let newEntity: LevelEntity;

    if (type === 'circle') {
      newEntity = {
        id: `wall-${Date.now()}`,
        kind: 'wall',
        shape: 'circle',
        cx: 450,
        cy: 800,
        radius: 100,
      };
    } else if (type === 'rect') {
      newEntity = {
        id: `wall-${Date.now()}`,
        kind: 'wall',
        shape: 'rect',
        x: 350,
        y: 700,
        width: 200,
        height: 200,
      };
    } else {
      newEntity = {
        id: `wall-${Date.now()}`,
        kind: 'wall',
        shape: 'polygon',
        points: [[350, 700], [550, 700], [550, 900], [350, 900]],
      };
    }
    
    updateLevel({
      ...currentLevel,
      entities: [...(currentLevel.entities || []), newEntity],
    });
    setSelectedEntityId(newEntity.id);
    setSelectedBallId(null);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  // Add ball
  const addBall = useCallback(() => {
    if (!currentLevel) return;
    
    const newBall: BallConfig = {
      id: `ball-${Date.now()}`,
      initialSpeed: 300,
      topSpeed: 600,
      color: getRandomColor(),
    };
    
    updateLevel({
      ...currentLevel,
      balls: [...currentLevel.balls, newBall],
    });
    setSelectedBallId(newBall.id);
    setSelectedEntityId(null);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  // Add a Colored Area (win-gate zone). Sized by kind, per the LEVELDESIGN
  // convention: var is easiest so it's drawn biggest, const hardest/smallest.
  const addArea = useCallback((kind: AreaKind) => {
    if (!currentLevel) return;

    const existing = currentLevel.coloredAreas || [];
    updateLevel({ ...currentLevel, coloredAreas: [...existing, makeColoredArea(kind, existing.length)] });
    setSelectedAreaIndex(existing.length);
    setSelectedEntityId(null);
    setSelectedBallId(null);
  }, [currentLevel, updateLevel]);

  // Update a Colored Area by index
  const updateArea = useCallback((index: number, updates: Partial<ColoredArea>) => {
    if (!currentLevel) return;

    updateLevel({
      ...currentLevel,
      coloredAreas: (currentLevel.coloredAreas || []).map((a, i) =>
        i === index ? { ...a, ...updates } : a
      ),
    });
  }, [currentLevel, updateLevel]);

  // Delete a Colored Area by index (drop the key entirely when it was the last)
  const deleteArea = useCallback((index: number) => {
    if (!currentLevel) return;

    const remaining = (currentLevel.coloredAreas || []).filter((_, i) => i !== index);
    const next = { ...currentLevel, coloredAreas: remaining };
    if (remaining.length === 0) delete next.coloredAreas;
    updateLevel(next);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  /**
   * Gravity wells (issue #77). Defaults follow the authoring rule the game
   * enforces: narrow and fierce beats wide and gentle, and a new well starts
   * mid-board rather than near an edge, since a well that pulls into a wall it
   * is sitting against pins balls against it (see pullsIntoWall).
   */
  const addWell = useCallback(() => {
    if (!currentLevel) return;
    const existing = currentLevel.gravityWells || [];
    const offset = existing.length * 30;
    updateLevel({
      ...currentLevel,
      gravityWells: [...existing, {
        x: 330 + offset, y: 300 + offset, width: 240, height: 170, turnRate: 2.8,
      }],
    });
    setSelectedWellIndex(existing.length);
    setSelectedAreaIndex(null);
    setSelectedEntityId(null);
    setSelectedBallId(null);
  }, [currentLevel, updateLevel]);

  const updateWell = useCallback((index: number, updates: Partial<GravityWell>) => {
    if (!currentLevel) return;
    updateLevel({
      ...currentLevel,
      gravityWells: (currentLevel.gravityWells || []).map((w, i) => {
        if (i !== index) return w;
        const next = { ...w, ...updates };
        // An `undefined` in `updates` means CLEAR, not "set to undefined": a
        // spread would leave the key present, and the YAML dump turns that into
        // an explicit `activeFrom: null` that reads back as a real value.
        for (const k of Object.keys(updates) as (keyof GravityWell)[]) {
          if (updates[k] === undefined) delete next[k];
        }
        return next;
      }),
    });
  }, [currentLevel, updateLevel]);

  const deleteWell = useCallback((index: number) => {
    if (!currentLevel) return;
    const remaining = (currentLevel.gravityWells || []).filter((_, i) => i !== index);
    const next = { ...currentLevel, gravityWells: remaining };
    if (remaining.length === 0) delete next.gravityWells;
    updateLevel(next);
    setSelectedWellIndex(null);
  }, [currentLevel, updateLevel]);

  // Delete selected entity
  const deleteEntity = useCallback((entityId: string) => {
    if (!currentLevel) return;
    
    updateLevel({
      ...currentLevel,
      entities: (currentLevel.entities || []).filter(e => e.id !== entityId),
    });
    if (selectedEntityId === entityId) {
      setSelectedEntityId(null);
    }
  }, [currentLevel, updateLevel, selectedEntityId]);

  // Duplicate entity (offset copy by 30px)
  const duplicateEntity = useCallback((entityId: string) => {
    if (!currentLevel) return;
    const entity = (currentLevel.entities || []).find(e => e.id === entityId);
    if (!entity) return;

    const newEntity: LevelEntity = JSON.parse(JSON.stringify(entity));
    newEntity.id = `wall-${Date.now()}`;
    // Offset the copy so it's visually distinct
    if (newEntity.shape === 'rect') {
      (newEntity as WallRectEntity).x += 30;
      (newEntity as WallRectEntity).y += 30;
    } else if (newEntity.shape === 'circle') {
      (newEntity as WallCircleEntity).cx += 30;
      (newEntity as WallCircleEntity).cy += 30;
    } else if (newEntity.shape === 'polygon') {
      (newEntity as WallPolygonEntity).points = (newEntity as WallPolygonEntity).points.map(
        ([x, y]) => [x + 30, y + 30],
      );
    }

    updateLevel({
      ...currentLevel,
      entities: [...(currentLevel.entities || []), newEntity],
    });
    setSelectedEntityId(newEntity.id);
    setSelectedBallId(null);
    setSelectedAreaIndex(null);
  }, [currentLevel, updateLevel]);

  // Copy the selected object (entity or ball) into the clipboard.
  const copySelection = useCallback(() => {
    if (!currentLevel) return;
    if (selectedEntityId) {
      const entity = (currentLevel.entities || []).find(e => e.id === selectedEntityId);
      if (entity) clipboardRef.current = { kind: 'entity', data: JSON.parse(JSON.stringify(entity)) };
    } else if (selectedBallId) {
      const ball = currentLevel.balls.find(b => b.id === selectedBallId);
      if (ball) clipboardRef.current = { kind: 'ball', data: JSON.parse(JSON.stringify(ball)) };
    }
  }, [currentLevel, selectedEntityId, selectedBallId]);

  // Paste the clipboard object into the current level as a new, offset copy.
  // Repeated pastes cascade (each advances the clipboard position) so they
  // don't stack perfectly on top of one another.
  const pasteClipboard = useCallback(() => {
    if (!currentLevel) return;
    const clip = clipboardRef.current;
    if (!clip) return;

    if (clip.kind === 'entity') {
      const newEntity: LevelEntity = JSON.parse(JSON.stringify(clip.data));
      newEntity.id = `wall-${Date.now()}`;
      // Offset the copy so it's visually distinct from the source.
      if (newEntity.shape === 'rect') {
        (newEntity as WallRectEntity).x += 30;
        (newEntity as WallRectEntity).y += 30;
      } else if (newEntity.shape === 'circle') {
        (newEntity as WallCircleEntity).cx += 30;
        (newEntity as WallCircleEntity).cy += 30;
      } else if (newEntity.shape === 'polygon') {
        (newEntity as WallPolygonEntity).points = (newEntity as WallPolygonEntity).points.map(
          ([x, y]) => [x + 30, y + 30],
        );
      }
      updateLevel({
        ...currentLevel,
        entities: [...(currentLevel.entities || []), newEntity],
      });
      setSelectedEntityId(newEntity.id);
      setSelectedBallId(null);
      // Cascade the next paste from this copy's position.
      clipboardRef.current = { kind: 'entity', data: JSON.parse(JSON.stringify(newEntity)) };
    } else {
      const newBall: BallConfig = JSON.parse(JSON.stringify(clip.data));
      newBall.id = `ball-${Date.now()}`;
      updateLevel({
        ...currentLevel,
        balls: [...currentLevel.balls, newBall],
      });
      setSelectedBallId(newBall.id);
      setSelectedEntityId(null);
    }
  }, [currentLevel, updateLevel]);

  // Delete ball (prevent if last one)
  const deleteBall = useCallback((ballId: string) => {
    if (!currentLevel || currentLevel.balls.length <= 1) return;
    
    updateLevel({
      ...currentLevel,
      balls: currentLevel.balls.filter(b => b.id !== ballId),
    });
    if (selectedBallId === ballId) {
      setSelectedBallId(null);
    }
  }, [currentLevel, updateLevel, selectedBallId]);

  // Update entity
  const updateEntity = useCallback((entityId: string, updates: Partial<LevelEntity>) => {
    if (!currentLevel) return;
    
    updateLevel({
      ...currentLevel,
      entities: (currentLevel.entities || []).map(e => 
        e.id === entityId ? { ...e, ...updates } as LevelEntity : e
      ),
    });
  }, [currentLevel, updateLevel]);

  // Update ball
  const updateBall = useCallback((ballId: string, updates: Partial<BallConfig>) => {
    if (!currentLevel) return;
    
    updateLevel({
      ...currentLevel,
      balls: currentLevel.balls.map(b => 
        b.id === ballId ? { ...b, ...updates } : b
      ),
    });
  }, [currentLevel, updateLevel]);

  // Export YAML
  const exportYaml = useCallback(() => {
    const yamlContent = yaml.dump({ levels }, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    
    const blob = new Blob([yamlContent], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'map.yml';
    a.click();
    URL.revokeObjectURL(url);
  }, [levels]);

  // Save YAML to server (dev server must be running)
  const saveToServer = useCallback(async () => {
    setSaveStatus('saving');
    const yamlContent = yaml.dump({ levels }, { indent: 2, lineWidth: -1, noRefs: true });
    try {
      const res = await fetch('/api/map', {
        method: 'PUT',
        body: yamlContent,
        headers: { 'Content-Type': 'text/yaml' },
      });
      setSaveStatus(res.ok ? 'saved' : 'error');
    } catch {
      setSaveStatus('error');
    }
    setTimeout(() => setSaveStatus('idle'), 2500);
  }, [levels]);

  // Copy YAML to clipboard
  const copyYaml = useCallback(() => {
    const yamlContent = yaml.dump({ levels }, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
    navigator.clipboard.writeText(yamlContent);
    alert('YAML copied to clipboard!');
  }, [levels]);

  // Keyboard shortcuts: Delete/Backspace to remove the selected object, and
  // Ctrl/Cmd+C / Ctrl/Cmd+V to copy and paste it. Typing in a field falls
  // through to native behaviour (so copy/paste there edits the field value).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'c') {
        if (selectedEntityId || selectedBallId) {
          e.preventDefault();
          copySelection();
        }
      } else if (mod && key === 'v') {
        if (clipboardRef.current) {
          e.preventDefault();
          pasteClipboard();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedEntityId) {
          deleteEntity(selectedEntityId);
        } else if (selectedAreaIndex !== null) {
          deleteArea(selectedAreaIndex);
        } else if (selectedBallId && currentLevel && currentLevel.balls.length > 1) {
          deleteBall(selectedBallId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntityId, selectedBallId, selectedAreaIndex, deleteEntity, deleteBall, deleteArea, currentLevel, copySelection, pasteClipboard]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading levels...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 p-3 bg-card border-b border-border flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-bold text-primary flex-1">Map Builder</h1>
        <button
          onClick={() => setSnapToGrid(s => !s)}
          className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            snapToGrid
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
          title={snapToGrid ? 'Snap to grid (ON)' : 'Snap to grid (OFF)'}
        >
          Snap
        </button>
        <button
          onClick={copyYaml}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          title="Copy YAML to clipboard"
        >
          <Copy className="w-4 h-4" />
        </button>
        <button
          onClick={exportYaml}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          title="Download YAML"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={saveToServer}
          disabled={saveStatus === 'saving'}
          className={`p-2 rounded-lg transition-colors ${
            saveStatus === 'saved'  ? 'bg-green-600 text-white' :
            saveStatus === 'error'  ? 'bg-destructive text-white' :
            'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
          title={
            saveStatus === 'saved'  ? 'Saved!' :
            saveStatus === 'error'  ? 'Save failed - dev server running?' :
            'Save to disk (requires dev server)'
          }
        >
          {saveStatus === 'saved'  ? <Check className="w-4 h-4" /> :
           saveStatus === 'error'  ? <AlertCircle className="w-4 h-4" /> :
           <Save className="w-4 h-4" />}
        </button>
      </div>

      {/* Level Selector */}
      <div className="flex-shrink-0 p-2 bg-muted/50 border-b border-border overflow-x-auto">
        <div className="flex gap-2 items-center min-w-max">
          {levels.map((level, index) => (
            <div key={level.id} className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  setSelectedLevelIndex(index);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                className={`px-3 py-1.5 rounded-l text-sm font-medium transition-colors ${
                  index === selectedLevelIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-card/80'
                }`}
              >
                {level.id}
              </button>
              {index === selectedLevelIndex && (
                <button
                  onClick={() => duplicateLevel(index)}
                  className="px-1.5 py-1.5 rounded-r bg-primary/80 text-primary-foreground hover:bg-primary/60 transition-colors"
                  title="Duplicate level"
                >
                  <Copy className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={createNewLevel}
            className="p-1.5 rounded bg-card hover:bg-card/80 transition-colors"
            title="Add Level"
          >
            <Plus className="w-4 h-4" />
          </button>
          {levels.length > 1 && (
            <button
              onClick={deleteLevel}
              className="p-1.5 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
              title="Delete Level"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Canvas Area — min-w-0 so the canvas' intrinsic buffer width can't
            push the side panel off-screen (flex items default to min-width:auto). */}
        <div className="flex-1 min-h-0 min-w-0 p-2">
          {currentLevel && (
            <MapCanvas
              level={currentLevel}
              selectedEntityId={selectedEntityId}
              selectedBallId={selectedBallId}
              selectedAreaIndex={selectedAreaIndex}
              selectedWellIndex={selectedWellIndex}
              snapToGrid={snapToGrid}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setSelectedBallId(null);
                setSelectedAreaIndex(null);
                setSelectedWellIndex(null);
              }}
              onSelectBall={(id) => {
                setSelectedBallId(id);
                setSelectedEntityId(null);
                setSelectedAreaIndex(null);
                setSelectedWellIndex(null);
              }}
              onSelectArea={(index) => {
                setSelectedAreaIndex(index);
                setSelectedEntityId(null);
                setSelectedBallId(null);
                setSelectedWellIndex(null);
              }}
              onUpdateEntity={updateEntity}
              onUpdateBall={updateBall}
              onUpdateArea={updateArea}
              onSelectWell={(index) => {
                setSelectedWellIndex(index);
                setSelectedEntityId(null);
                setSelectedBallId(null);
                setSelectedAreaIndex(null);
              }}
              onUpdateWell={updateWell}
            />
          )}
        </div>

        {/* Side Panel */}
        <div className="flex-shrink-0 w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-border bg-card overflow-y-auto max-h-64 lg:max-h-full lg:h-full">
          {currentLevel && (
            <>
              <LevelPanel
                level={currentLevel}
                onUpdateLevel={updateLevel}
              />
              <EntityPanel
                level={currentLevel}
                selectedEntityId={selectedEntityId}
                selectedBallId={selectedBallId}
                selectedAreaIndex={selectedAreaIndex}
                selectedWellIndex={selectedWellIndex}
                onSelectWell={(index) => {
                  setSelectedWellIndex(index);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                onAddWell={addWell}
                onDeleteWell={deleteWell}
                onUpdateWell={updateWell}
                onSelectEntity={(id) => {
                  setSelectedEntityId(id);
                  setSelectedBallId(null);
                  setSelectedAreaIndex(null);
                }}
                onSelectBall={(id) => {
                  setSelectedBallId(id);
                  setSelectedEntityId(null);
                  setSelectedAreaIndex(null);
                }}
                onSelectArea={(index) => {
                  setSelectedAreaIndex(index);
                  setSelectedEntityId(null);
                  setSelectedBallId(null);
                }}
                onAddEntity={addEntity}
                onAddBall={addBall}
                onAddArea={addArea}
                onDeleteEntity={deleteEntity}
                onDuplicateEntity={duplicateEntity}
                onDeleteBall={deleteBall}
                onDeleteArea={deleteArea}
                onUpdateEntity={updateEntity}
                onUpdateBall={updateBall}
                onUpdateArea={updateArea}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getRandomColor(): string {
  const colors = ['ff6b6b', '4ecdc4', 'ffd93d', '6bcb77', 'c792ea', '00d4ff', 'ff8c42'];
  return colors[Math.floor(Math.random() * colors.length)];
}
