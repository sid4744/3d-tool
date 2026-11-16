import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Trash2, ArrowDownToLine, PackagePlus, Video, VideoOff, MapPin, Globe, X, Armchair, Map as MapIcon } from 'lucide-react';
import type { SiteData, SiteColors, SiteAlign } from '../utils/site';
import { SITE_PRESETS, ELEMENT_LABEL } from '../utils/site';
import { fmtClock, type SunSettings } from '../utils/sun';
import { Sun, Play, Pause, Wand2, ChevronDown, Layers as LayersIcon, Rotate3d } from 'lucide-react';
import { Btn, IconBtn, Section, Field, Stat, Dot, PanelContext, cx } from './ui';
import { CornerPoleIcon, PoleStylePicker, PoleHeightInput } from './PoleIcons';
import type { PoleStyle, TurntableState } from '../types';
import type { LayerState, SelectionItem, TentData, MaterialReport } from '../types';
import type { TrackingInfo } from '../hooks/useHeadTracking';
import { formatArea } from '../utils/geometry';

// ---------------------------------------------------------------- depth view

export interface DepthSettings { strength: number; diag: number; fov: number }

export const DepthSection = ({
  settings, onChange, tracking, preview, onPreview,
}: {
  settings: DepthSettings;
  onChange: (s: DepthSettings) => void;
  tracking: TrackingInfo;
  preview: boolean;
  onPreview: (v: boolean) => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = preview ? tracking.stream : null;
    if (preview && tracking.stream) v.play().catch(() => {});
  }, [preview, tracking.stream]);

  const tone = tracking.status === 'tracking' ? 'ok' : tracking.status === 'error' ? 'bad' : 'warn';
  const label =
    tracking.status === 'tracking' ? `Tracking · ${tracking.distanceCm} cm away`
    : tracking.status === 'lost' ? 'Face not visible'
    : tracking.status === 'error' ? tracking.message
    : 'Starting…';

  return (
    <Section
      title="Depth view"
      aside={
        <span className="flex items-center gap-1.5 text-xs text-muted"><Dot tone={tone} />{label}</span>
      }
    >
      <p className="text-xs text-muted mb-3 leading-[17px]">
        The viewport acts as a window. Move your head and the scene is re-projected from your eyes.
        {tracking.status === 'error' && ' Without a camera, the mouse stands in for your head.'}
      </p>
      <div className="space-y-3">
        <Field label="Depth strength" value={`${settings.strength.toFixed(1)}×`}>
          <input type="range" min={0.3} max={2.5} step={0.1} value={settings.strength}
            onChange={(e) => onChange({ ...settings, strength: +e.target.value })} />
        </Field>
        <Field label="Screen size (diagonal, inches)">
          <input type="number" min={5} max={90} step={0.1} value={settings.diag} className="w-full"
            onChange={(e) => onChange({ ...settings, diag: Math.max(5, +e.target.value || 15.6) })} />
        </Field>
        <Field label="Webcam field of view" value={`${settings.fov}°`}>
          <input type="range" min={45} max={95} step={1} value={settings.fov}
            onChange={(e) => onChange({ ...settings, fov: +e.target.value })} />
        </Field>
        <p className="text-2xs text-faint leading-[15px]">
          If the distance above does not match a tape measure, adjust the field of view until it does.
        </p>
        <Btn size="sm" onClick={() => onPreview(!preview)} disabled={!tracking.stream}>
          {preview ? <VideoOff size={13} /> : <Video size={13} />} {preview ? 'Hide camera' : 'Show camera'}
        </Btn>
        <video
          ref={videoRef} muted playsInline
          className={cx('w-full rounded-md border border-line -scale-x-100', !preview && 'hidden')}
        />
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------- selection

export const SelectionSection = ({
  selections, tentData, onPoleHeight, onDelete, onDropToGround, onPoleYaw, onPoleFaceOut, onPoleStyle, guyLines, onToggleGuyLines,
}: {
  onPoleStyle: (s: PoleStyle) => void;
  guyLines: boolean;
  onToggleGuyLines: () => void;
  onPoleYaw: (deg: number) => void;
  onPoleFaceOut: () => void;
  selections: SelectionItem[];
  tentData: TentData;
  onPoleHeight: (h: number) => void;
  onDelete: () => void;
  onDropToGround: () => void;
}) => {
  const count = (t: SelectionItem['type']) => selections.filter((s) => s.type === t).length;
  const parts = [
    count('pole') && `${count('pole')} pole${count('pole') > 1 ? 's' : ''}`,
    count('furniture') && `${count('furniture')} furniture`,
    count('model') && `${count('model')} object${count('model') > 1 ? 's' : ''}`,
    count('tent') && 'Tent',
  ].filter(Boolean) as string[];
  const single = selections.length === 1 ? selections[0] : null;
  const canDelete = selections.some((s) => s.type !== 'tent');

  return (
    <Section title="Selection" aside={<span className="text-xs text-accent">{parts.join(' · ')}</span>}>
      <div className="space-y-3">
        {single?.type === 'pole' && (
          <>
            <Field label="Pole type">
              <PoleStylePicker value={tentData.poles[single.id as number]?.style ?? 'steel'} onChange={onPoleStyle} />
            </Field>
            <Field label="Pole height (m)">
              <PoleHeightInput style={tentData.poles[single.id as number]?.style ?? 'steel'}
                value={tentData.poles[single.id as number]?.height ?? 0} onChange={onPoleHeight} />
            </Field>
            <Field label={(tentData.poles[single.id as number]?.style ?? 'steel') === 'wood' ? 'Guy line direction' : 'Lean direction'}
              value={`${Math.round((((((tentData.poles[single.id as number]?.yaw ?? 0) * 180) / Math.PI) % 360) + 360) % 360)}°`}>
              <input type="range" min={0} max={359} step={1}
                value={Math.round((((((tentData.poles[single.id as number]?.yaw ?? 0) * 180) / Math.PI) % 360) + 360) % 360)}
                onChange={(e) => onPoleYaw(+e.target.value)} />
            </Field>
            <Btn size="sm" className="w-full" onClick={onPoleFaceOut}>Point away from the tent</Btn>
            <Btn size="sm" className="w-full" onClick={onToggleGuyLines}>{guyLines ? 'Turn guy lines off' : 'Turn guy lines on'}</Btn>
          </>
        )}
        <div className="flex gap-2">
          {count('model') > 0 && (
            <Btn size="sm" className="flex-1" onClick={onDropToGround}>
              <ArrowDownToLine size={13} /> Drop to ground
            </Btn>
          )}
          {canDelete && (
            <Btn size="sm" variant="danger" className="flex-1" onClick={onDelete}>
              <Trash2 size={13} /> Delete
            </Btn>
          )}
        </div>
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------- colour palette

export const PaletteSection = ({
  palette, custom, onAdd, onRemove, onReset, targetCount, activeColor, onPick,
}: {
  palette: string[];
  custom: string[];
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
  onReset: () => void;
  targetCount: number;
  activeColor: string | null | undefined;
  onPick: (c: string | undefined) => void;
}) => {
  const [draft, setDraft] = useState('#4f8cff');
  return (
    <Section
      title="Colours"
      aside={<Btn size="sm" variant="ghost" onClick={onReset}>Reset</Btn>}
    >
      <p className="text-2xs text-faint leading-[15px] mb-2.5">
        {targetCount > 0
          ? `Click a colour to paint the ${targetCount} selected object${targetCount > 1 ? 's' : ''}.`
          : 'Select an imported object, then click a colour. New objects take the next colour in turn.'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((c) => (
          <span key={c} className="relative group/sw">
            <button
              onClick={() => onPick(c)} disabled={targetCount === 0}
              aria-label={`Colour ${c}`} title={c}
              className={cx(
                'h-6 w-6 rounded-md border transition-transform enabled:hover:scale-110 disabled:opacity-60',
                activeColor?.toLowerCase() === c.toLowerCase() ? 'border-ink ring-2 ring-accent' : 'border-line',
              )}
              style={{ background: c }}
            />
            {custom.includes(c) && (
              <button
                onClick={() => onRemove(c)} aria-label={`Remove ${c}`}
                className="absolute -top-1.5 -right-1.5 hidden group-hover/sw:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-raised border border-line text-faint hover:text-ink text-[9px] leading-none"
              >×</button>
            )}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <input type="color" value={draft} onChange={(e) => setDraft(e.target.value)}
          className="h-7 w-9 rounded-md border border-line bg-transparent p-0 cursor-pointer" aria-label="New colour" />
        <Btn size="sm" className="flex-1" onClick={() => onAdd(draft)}>Save to palette</Btn>
        {targetCount > 0 && (
          <Btn size="sm" variant="ghost" onClick={() => onPick(undefined)}>Original</Btn>
        )}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------- site location

const SiteBody = ({
  site, onOpen, onRemove, colors, preset, onPreset, onColor, align, onAlign, alignMode, onAlignMode, canCentre, onCentre, onAuto, scanY, onScanY, lift, onLift, onDrop, buildingMode, onBuildingMode, showHidden, onShowHidden, hiddenCount,
}: {
  onAuto: () => void;
  scanY: number; onScanY: (v: number) => void; lift: number; onLift: (v: number) => void; onDrop: () => void;
  buildingMode: 'all' | 'clear' | 'none'; onBuildingMode: (m: 'all' | 'clear' | 'none') => void;
  showHidden: boolean; onShowHidden: (v: boolean) => void; hiddenCount: number;
  align: SiteAlign; onAlign: (a: SiteAlign) => void;
  alignMode: 'translate' | 'rotate' | null; onAlignMode: (m: 'translate' | 'rotate' | null) => void;
  canCentre: boolean; onCentre: () => void;
  site: SiteData | null; onOpen: () => void; onRemove: () => void;
  colors: SiteColors; preset: string; onPreset: (id: string) => void; onColor: (k: keyof SiteColors, c: string) => void;
}) => (
  <div>
    {site ? (
      <>
        <div className="text-sm text-ink truncate" title={site.name}>{site.name}</div>
        <div className="font-mono text-2xs text-faint mt-0.5">{site.lat.toFixed(5)}, {site.lon.toFixed(5)}</div>
        <div className="text-2xs text-muted mt-1.5">
          {site.buildings.length} buildings · {site.roads.length} roads · {site.radius} m radius
        </div>
        <div className="mt-3.5 text-2xs uppercase tracking-wide text-faint mb-1.5">Align your scan</div>
        {canCentre && !alignMode && (
          <Btn size="sm" variant="primary" className="w-full mb-2" onClick={onAuto}>
            <Wand2 size={13} /> Auto-align from satellite
          </Btn>
        )}
        {alignMode ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-2.5 space-y-2.5">
            <p className="text-2xs text-muted leading-[15px]">
              The map stays put, north-up. Drag the arrows on your scan to move or turn it (best from the Top view), or type exact values.
            </p>
            <div className="flex gap-1">
              {(['translate', 'rotate'] as const).map((m) => (
                <button key={m} onClick={() => onAlignMode(m)}
                  className={cx('flex-1 h-6 rounded-md border text-xs transition-colors',
                    alignMode === m ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-ink hover:bg-hover')}>
                  {m === 'translate' ? 'Move' : 'Rotate'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="East (m)">
                <input type="number" step={0.5} value={+align.x.toFixed(2)} className="w-full font-mono"
                  onChange={(e) => onAlign({ ...align, x: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="South (m)">
                <input type="number" step={0.5} value={+align.z.toFixed(2)} className="w-full font-mono"
                  onChange={(e) => onAlign({ ...align, z: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="Rotate (°)">
                <input type="number" step={0.5} value={+align.rot.toFixed(2)} className="w-full font-mono"
                  onChange={(e) => onAlign({ ...align, rot: parseFloat(e.target.value) || 0 })} />
              </Field>
              <Field label="Scale">
                <input type="number" step={0.01} min={0.1} value={+align.scale.toFixed(3)} className="w-full font-mono"
                  onChange={(e) => onAlign({ ...align, scale: Math.max(0.1, parseFloat(e.target.value) || 1) })} />
              </Field>
            </div>
            <Field label="Fine rotate" value={`${align.rot.toFixed(1)}°`}>
              <input type="range" min={-180} max={180} step={0.5} value={Math.max(-180, Math.min(180, align.rot))}
                onChange={(e) => onAlign({ ...align, rot: +e.target.value })} />
            </Field>
            <div className="flex gap-2">
              {canCentre && <Btn size="sm" className="flex-1" onClick={onCentre}>Centre scan on site</Btn>}
              <Btn size="sm" variant="ghost" onClick={() => onAlign({ x: 0, z: 0, rot: 0, scale: 1 })}>Reset</Btn>
              <Btn size="sm" variant="primary" onClick={() => onAlignMode(null)}>Done</Btn>
            </div>
          </div>
        ) : (
          <Btn size="sm" className="w-full" onClick={() => onAlignMode('translate')}>
            Align scan to map{(align.x || align.z || align.rot || align.scale !== 1) ? ' (adjusted)' : ''}
          </Btn>
        )}
        {canCentre && (
          <>
            <div className="mt-3.5 text-2xs uppercase tracking-wide text-faint mb-1.5">Scan floor</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Scan height (m)">
                <input type="number" step={0.1} value={+scanY.toFixed(2)} className="w-full font-mono"
                  onChange={(e) => onScanY(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Above map (m)">
                <input type="number" step={0.05} min={0} value={lift} className="w-full font-mono"
                  onChange={(e) => onLift(Math.max(0, parseFloat(e.target.value) || 0))} />
              </Field>
            </div>
            <Btn size="sm" className="w-full mt-2" onClick={onDrop}><ArrowDownToLine size={13} /> Drop scan floor to map</Btn>
          </>
        )}
        <div className="mt-3.5 text-2xs uppercase tracking-wide text-faint mb-1.5">Map buildings</div>
        <div className="flex gap-1">
          {([['all', 'Show'], ['clear', 'Auto-hide'], ['none', 'Hide']] as const).map(([m, label]) => (
            <button key={m} onClick={() => onBuildingMode(m)} disabled={m === 'clear' && !canCentre}
              title={m === 'clear' ? (canCentre ? 'Hide map buildings that overlap the scan' : 'Open a scan first') : undefined}
              className={cx('flex-1 h-6 rounded-md border text-2xs transition-colors disabled:opacity-40',
                buildingMode === m ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-ink hover:bg-hover')}>
              {label}
            </button>
          ))}
        </div>
        {buildingMode === 'clear' && canCentre && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input type="checkbox" checked={showHidden} onChange={(e) => onShowHidden(e.target.checked)} />
            <span>Show buildings hidden by the scan{hiddenCount > 0 ? ` (${hiddenCount})` : ''}</span>
          </label>
        )}
        <div className="mt-3.5 text-2xs uppercase tracking-wide text-faint mb-1.5">Map colours</div>
        <div className="flex flex-wrap gap-1 mb-2.5">
          {[{ id: 'auto', label: 'Auto' }, ...SITE_PRESETS].map((p) => (
            <button
              key={p.id} onClick={() => onPreset(p.id)}
              className={cx(
                'h-6 px-2 rounded-md border text-xs transition-colors',
                preset === p.id ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-ink hover:bg-hover',
              )}
            >{p.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {(Object.keys(ELEMENT_LABEL) as Array<keyof SiteColors>).map((k) => (
            <label key={k} className="flex flex-col items-center gap-1 cursor-pointer" title={`${ELEMENT_LABEL[k]} colour`}>
              <input type="color" value={colors[k]} onChange={(e) => onColor(k, e.target.value)}
                className="h-6 w-full rounded-md border border-line bg-transparent p-0 cursor-pointer" aria-label={`${ELEMENT_LABEL[k]} colour`} />
              <span className="text-[10px] text-faint">{ELEMENT_LABEL[k]}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Btn size="sm" className="flex-1" onClick={onOpen}><Globe size={13} /> Change</Btn>
          <Btn size="sm" variant="danger" onClick={onRemove}><Trash2 size={13} /> Remove</Btn>
        </div>
      </>
    ) : (
      <>
        <p className="text-2xs text-faint leading-[15px] mb-3">
          Pick a place on the map and the buildings, roads and water around it appear under your tent, to scale.
        </p>
        <Btn size="sm" variant="primary" className="w-full" onClick={onOpen}><Globe size={13} /> Pick a location</Btn>
      </>
    )}
  </div>
);

/** Floating map/site panel under the layers panel (opened from the Map button on the tool rail). */
export const SitePanel = (props: React.ComponentProps<typeof SiteBody> & { onClose: () => void }) => {
  const { onClose, ...rest } = props;
  return (
    <div className="w-[264px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm animate-rise" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center h-8 pl-2.5 pr-1 border-b border-line">
        <MapIcon size={13} className="text-muted mr-2 shrink-0" />
        <span className="text-xs font-medium text-ink flex-1">Map</span>
        <IconBtn className="h-6 w-6" onClick={onClose} aria-label="Close map"><X size={13} /></IconBtn>
      </div>
      <div className="p-2.5 max-h-[calc(100vh-220px)] overflow-y-auto">
        <SiteBody {...rest} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- sun

const SEASONS: { label: string; md: string }[] = [
  { label: 'Spring', md: '03-20' }, { label: 'Summer', md: '06-21' }, { label: 'Autumn', md: '09-22' }, { label: 'Winter', md: '12-21' },
];

export const SunPanel = ({
  sun, onChange, altitudeDeg, azimuthDeg, rise, set, where, northLocked, playing, onPlay, onClose,
}: {
  sun: SunSettings; onChange: (s: SunSettings) => void;
  altitudeDeg: number; azimuthDeg: number; rise: number | null; set: number | null;
  where: string; northLocked: boolean; playing: boolean; onPlay: (v: boolean) => void; onClose: () => void;
}) => {
  const year = sun.date.slice(0, 4);
  const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(azimuthDeg / 45) % 8];
  return (
    <div className="w-[264px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm animate-rise" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center h-8 pl-2.5 pr-1 border-b border-line">
        <Sun size={13} className="text-muted mr-2 shrink-0" />
        <span className="text-xs font-medium text-ink flex-1">Sun &amp; shadows</span>
        <button
          onClick={() => onChange({ ...sun, on: !sun.on })} aria-pressed={sun.on}
          className={cx('inline-flex items-center gap-1 text-xs mr-1.5', sun.on ? 'text-accent' : 'text-faint hover:text-ink')}
        >{sun.on ? 'On' : 'Off'}</button>
        <IconBtn className="h-6 w-6" onClick={onClose} aria-label="Close sun"><X size={13} /></IconBtn>
      </div>
      <div className="p-2.5 max-h-[calc(100vh-220px)] overflow-y-auto">
      {sun.on ? (
        <div className="space-y-3">
          <Field label="Time of day" value={fmtClock(sun.minutes)}>
            <input type="range" min={0} max={1435} step={5} value={sun.minutes}
              onChange={(e) => onChange({ ...sun, minutes: +e.target.value })} />
          </Field>
          <div className="flex items-center gap-2 -mt-1">
            <Btn size="sm" variant={playing ? 'primary' : 'default'} onClick={() => onPlay(!playing)} aria-label="Animate the day">
              {playing ? <Pause size={12} /> : <Play size={12} />} {playing ? 'Pause' : 'Play day'}
            </Btn>
            <span className="text-2xs text-faint ml-auto font-mono">
              {rise !== null ? `↑ ${fmtClock(rise)}` : 'no rise'} · {set !== null ? `↓ ${fmtClock(set)}` : 'no set'}
            </span>
          </div>
          <Field label="Date">
            <input type="date" value={sun.date} className="w-full"
              onChange={(e) => e.target.value && onChange({ ...sun, date: e.target.value })} />
          </Field>
          <div className="flex gap-1">
            {SEASONS.map((s) => (
              <button key={s.label} onClick={() => onChange({ ...sun, date: `${year}-${s.md}` })}
                className={cx('flex-1 h-6 rounded-md border text-2xs transition-colors',
                  sun.date.slice(5) === s.md ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-ink hover:bg-hover')}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="UTC offset (h)">
              <input type="number" min={-12} max={14} step={1} value={sun.utcOffset} className="w-full"
                onChange={(e) => onChange({ ...sun, utcOffset: Math.max(-12, Math.min(14, +e.target.value || 0)) })} />
            </Field>
            <div className="flex flex-col justify-end text-right">
              <span className="font-mono text-sm text-ink tabular-nums">{altitudeDeg >= 0 ? `${altitudeDeg.toFixed(0)}° up` : 'below horizon'}</span>
              <span className="font-mono text-2xs text-faint">{dir} · {azimuthDeg.toFixed(0)}°</span>
            </div>
          </div>
          {!northLocked && (
            <Field label="North direction" value={`${sun.north}°`}>
              <input type="range" min={-180} max={180} step={1} value={sun.north}
                onChange={(e) => onChange({ ...sun, north: +e.target.value })} />
            </Field>
          )}
          <p className="text-2xs text-faint leading-[15px]">
            {where}. {northLocked ? 'Site maps are north-up, so shadows fall true to the real place.' : 'Turn the north direction to match how your model is oriented.'}
          </p>
        </div>
      ) : (
        <p className="text-2xs text-faint leading-[15px]">
          Turn on to light the scene with the real sun for any time of day and year, and cast shadows.
        </p>
      )}
    </div>
    </div>
  );
};

/** Generic floating card used to host an existing inspector section as a panel. */
export const PanelCard = ({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose?: () => void; children: React.ReactNode }) => (
  <div className="w-[264px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm animate-rise" onPointerDown={(e) => e.stopPropagation()}>
    <div className="flex items-center h-8 pl-2.5 pr-1 border-b border-line">
      <span className="text-muted mr-2 shrink-0 inline-flex">{icon}</span>
      <span className="text-xs font-medium text-ink flex-1">{title}</span>
      {onClose && <IconBtn className="h-6 w-6" onClick={onClose} aria-label={`Close ${title}`}><X size={13} /></IconBtn>}
    </div>
    <div className="p-2.5 max-h-[calc(100vh-220px)] overflow-y-auto">
      <PanelContext.Provider value={true}>{children}</PanelContext.Provider>
    </div>
  </div>
);

/** Turntable: pick a centre, then orbit it with live speed, direction, distance and tilt. */
export const TurntablePanel = ({ t, onChange, onPick, onClose }: {
  t: TurntableState; onChange: (p: Partial<TurntableState>) => void; onPick: () => void; onClose: () => void;
}) => (
  <PanelCard title="Turntable" icon={<Rotate3d size={13} />} onClose={onClose}>
    {!t.origin ? (
      <div className="text-xs text-muted leading-[17px]">
        <p className="text-ink font-medium mb-1">Set the centre</p>
        {t.picking ? 'Click on the ground where the turntable should turn around.' : 'Choose the point the camera will orbit.'}
        {!t.picking && <Btn size="sm" variant="primary" className="w-full mt-2.5" onClick={onPick}>Pick centre</Btn>}
      </div>
    ) : (
      <div className="space-y-3">
        <div className="flex gap-2">
          <Btn size="sm" variant="primary" className="flex-1" onClick={() => onChange({ playing: !t.playing })}>
            {t.playing ? <Pause size={13} /> : <Play size={13} />} {t.playing ? 'Pause' : 'Play'}
          </Btn>
          <Btn size="sm" className="flex-1" onClick={onPick}>{t.picking ? 'Click ground...' : 'New centre'}</Btn>
        </div>
        <Field label="Speed" value={`${t.speed}°/s · ${Math.round(360 / Math.max(t.speed, 1))}s per turn`}>
          <input type="range" min={1} max={90} step={1} value={t.speed} onChange={(e) => onChange({ speed: +e.target.value })} />
        </Field>
        <div className="flex gap-1" role="radiogroup" aria-label="Direction">
          {[{ v: false, l: 'Clockwise' }, { v: true, l: 'Anticlockwise' }].map((o) => (
            <button key={o.l} role="radio" aria-checked={t.reverse === o.v} onClick={() => onChange({ reverse: o.v })}
              className={cx('flex-1 h-7 rounded-md border text-xs transition-colors', t.reverse === o.v ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink hover:bg-hover')}>
              {o.l}
            </button>
          ))}
        </div>
        <Field label="Distance" value={`${(t.base * t.zoom).toFixed(1)} m`}>
          <input type="range" min={0.2} max={3} step={0.05} value={t.zoom} onChange={(e) => onChange({ zoom: +e.target.value })} />
        </Field>
        <Field label="Camera height angle" value={`${Math.round(t.elev)}°`}>
          <input type="range" min={3} max={85} step={1} value={t.elev} onChange={(e) => onChange({ elev: +e.target.value })} />
        </Field>
      </div>
    )}
  </PanelCard>
);

/** Floating corner-pole panel: pops up under the layers panel when finishing an outline, or from the tool rail. */
export const PolesPanel = ({
  offset, onOffset, height, onHeight, closed, cornerCount, onAdd, onPreview, onClose, poleStyle, onPoleStyle,
  shapeCount, activeShape, onShape,
}: {
  shapeCount: number; activeShape: number; onShape: (i: number) => void;
  poleStyle: PoleStyle; onPoleStyle: (s: PoleStyle) => void;
  offset: number; onOffset: (v: number) => void;
  height: number; onHeight: (v: number) => void;
  closed: boolean; cornerCount: number;
  onAdd: () => void; onPreview: (on: boolean) => void; onClose: () => void;
}) => (
  <div
    className="w-[212px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm animate-rise"
    onPointerDown={(e) => e.stopPropagation()}
    onMouseEnter={() => onPreview(true)} onMouseLeave={() => onPreview(false)}
  >
    <div className="flex items-center h-8 pl-2.5 pr-1 border-b border-line">
      <span className="text-muted mr-2 shrink-0 inline-flex"><CornerPoleIcon size={14} /></span>
      <span className="text-xs font-medium text-ink flex-1">Corner poles</span>
      <IconBtn className="h-6 w-6" onClick={onClose} aria-label="Close corner poles"><X size={13} /></IconBtn>
    </div>
    <div className="p-2.5">
      {shapeCount > 1 && (
        <div className="mb-2.5">
          <div className="text-2xs uppercase tracking-wide text-faint mb-1">Add poles to</div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: shapeCount }, (_, i) => (
              <button key={i} onClick={() => onShape(i)}
                className={cx('h-6 px-2 rounded-md border text-2xs transition-colors',
                  i === activeShape ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-ink hover:bg-hover')}>
                Shape {i + 1}
              </button>
            ))}
          </div>
          <p className="text-2xs text-faint mt-1">Or click a shape in the view.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Offset (m)">
          <input type="number" min={0} step={0.1} value={offset} className="w-full"
            onChange={(e) => onOffset(Math.max(0, parseFloat(e.target.value) || 0))} />
        </Field>
        <Field label="Height (m)">
          <PoleHeightInput style={poleStyle} value={height} onChange={onHeight} />
        </Field>
      </div>
      <div className="mt-2.5"><PoleStylePicker value={poleStyle} onChange={onPoleStyle} /></div>
      <p className="text-2xs text-faint leading-[15px] mt-2 mb-2.5">Each pole sits outside its corner. Values are remembered.</p>
      <Btn size="sm" variant="primary" className="w-full" disabled={!closed || cornerCount === 0} onClick={onAdd}>
        <MapPin size={13} />
        {closed ? `Add ${cornerCount} corner pole${cornerCount === 1 ? '' : 's'}${shapeCount > 1 ? ` to Shape ${activeShape + 1}` : ''}` : 'Close the outline first'}
      </Btn>
    </div>
  </div>
);

// ---------------------------------------------------------------- layers

const LAYER_LABEL: Record<keyof LayerState, string> = {
  model: 'Site model', sketch: 'Outline', grid: 'Grid', poles: 'Poles',
  measurements: 'Dimensions', furniture: 'Furniture', imports: 'Imported objects', fabric: 'Fabric panels', guyLines: 'Guy lines', site: 'Site context',
};
const CLEARABLE: Array<keyof LayerState> = ['sketch', 'poles', 'furniture', 'imports'];

/** Floating layers panel that lives in the viewport, beside the inspector. Collapsed it shows just the layer you last used. */
export const LayersSection = ({
  layers, onToggle, counts, onClear,
}: {
  layers: LayerState;
  onToggle: (k: keyof LayerState) => void;
  counts: Partial<Record<keyof LayerState, number>>;
  onClear: (k: keyof LayerState) => void;
  onImport?: () => void;
}) => {
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('qtents.layersOpen') !== '0'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('qtents.layersOpen', open ? '1' : '0'); } catch { /* storage unavailable */ } }, [open]);
  const [current, setCurrent] = useState<keyof LayerState>('model');
  const [armed, setArmed] = useState<keyof LayerState | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 2500);
    return () => clearTimeout(t);
  }, [armed]);

  const keys = Object.keys(LAYER_LABEL) as Array<keyof LayerState>;
  const row = (k: keyof LayerState, full: boolean) => {
    const n = counts[k];
    const canClear = full && CLEARABLE.includes(k) && !!n;
    return (
      <li key={k} className={cx('group flex items-center h-7 rounded-md pl-1.5 pr-1', current === k && full ? 'bg-hover' : 'hover:bg-hover')}>
        <button
          onClick={() => { setCurrent(k); onToggle(k); }}
          className={cx('flex flex-1 items-center gap-2 text-left text-sm', layers[k] ? 'text-ink' : 'text-faint')}
          aria-pressed={layers[k]}
        >
          {layers[k] ? <Eye size={14} className="text-muted" /> : <EyeOff size={14} />}
          {LAYER_LABEL[k]}
        </button>
        {n ? <span className="font-mono text-2xs text-faint mr-1">{n}</span> : null}
        {canClear && (
          armed === k ? (
            <Btn size="sm" variant="danger" onClick={() => { setArmed(null); onClear(k); }}>Delete {n}?</Btn>
          ) : (
            <IconBtn
              className="h-5 w-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => setArmed(k)} aria-label={`Delete all ${LAYER_LABEL[k]}`}
            >
              <Trash2 size={12} />
            </IconBtn>
          )
        )}
      </li>
    );
  };

  return (
    <div
      className="w-[212px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center h-8 pl-2.5 pr-1">
        <LayersIcon size={13} className="text-muted mr-2 shrink-0" />
        <span className="text-xs font-medium text-ink flex-1">Layers</span>
        <button
          onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'Collapse layers' : 'Show all layers'}
          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted hover:text-ink hover:bg-hover"
        >
          <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      <ul className="px-1 pb-1 border-t border-line pt-1">
        {open ? keys.map((k) => row(k, true)) : row(current, false)}
      </ul>
    </div>
  );
};

// ---------------------------------------------------------------- layout generator

const EXAMPLES = ['3 round tables (1m) and 10 chairs', '2 bars (3x1m), 1 stage, 5 stools'];

export const LayoutSection = ({
  prompt, onPrompt, onGenerate, disabled, reason,
}: { prompt: string; onPrompt: (v: string) => void; onGenerate: () => void; disabled: boolean; reason: string | null }) => (
  <Section title="Furnish layout">
    <textarea
      rows={3} value={prompt} onChange={(e) => onPrompt(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onGenerate(); }}
      placeholder="Describe what goes inside, e.g. 3 round tables (1m) and 10 chairs"
      className="w-full text-sm"
    />
    <div className="flex flex-wrap gap-1.5 mt-2">
      {EXAMPLES.map((e) => (
        <button key={e} onClick={() => onPrompt(e)}
          className="text-2xs text-muted hover:text-ink border border-line rounded-full px-2 py-0.5 transition-colors">
          {e}
        </button>
      ))}
    </div>
    <div className="flex items-center justify-between mt-3">
      <span className="text-2xs text-faint">{reason ?? 'Ctrl + Enter to run'}</span>
      <Btn size="sm" variant="primary" onClick={onGenerate} disabled={disabled || !prompt.trim()}>Place items</Btn>
    </div>
  </Section>
);

/** Floating furniture-layout panel under the layers panel (opened from the tool rail). */
export const LayoutPanel = ({
  prompt, onPrompt, onGenerate, disabled, reason, onClose,
}: { prompt: string; onPrompt: (v: string) => void; onGenerate: () => void; disabled: boolean; reason: string | null; onClose: () => void }) => (
  <div className="w-[212px] rounded-lg border border-line bg-panel/95 shadow-lg backdrop-blur-sm animate-rise" onPointerDown={(e) => e.stopPropagation()}>
    <div className="flex items-center h-8 pl-2.5 pr-1 border-b border-line">
      <Armchair size={13} className="text-muted mr-2 shrink-0" />
      <span className="text-xs font-medium text-ink flex-1">Furniture</span>
      <IconBtn className="h-6 w-6" onClick={onClose} aria-label="Close furniture"><X size={13} /></IconBtn>
    </div>
    <div className="p-2.5">
      <textarea
        rows={3} value={prompt} onChange={(e) => onPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onGenerate(); }}
        placeholder="Describe what goes inside, e.g. 3 round tables (1m) and 10 chairs"
        className="w-full text-sm"
      />
      <div className="flex flex-wrap gap-1.5 mt-2">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => onPrompt(e)}
            className="text-2xs text-muted hover:text-ink border border-line rounded-full px-2 py-0.5 transition-colors">
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2.5 gap-2">
        <span className="text-2xs text-faint">{reason ?? 'Ctrl + Enter'}</span>
        <Btn size="sm" variant="primary" onClick={onGenerate} disabled={disabled || !prompt.trim()}>Place items</Btn>
      </div>
    </div>
  </div>
);

export interface OptionStat { id: string; name: string; area: number; fabric: number; shapes: number }

/** Swap between the saved sketch options with a slider; shows how each compares. */
export const OptionsSection = ({ options, activeId, onSwitch }: { options: OptionStat[]; activeId: string; onSwitch: (id: string) => void }) => {
  const idx = Math.max(0, options.findIndex((o) => o.id === activeId));
  return (
    <Section title="Options">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm text-ink truncate">{options[idx]?.name}</span>
        <span className="font-mono text-2xs text-faint">{idx + 1} / {options.length}</span>
      </div>
      <input
        type="range" min={0} max={options.length - 1} step={1} value={idx} className="w-full"
        aria-label="Swap between options"
        onChange={(e) => { const o = options[+e.target.value]; if (o) onSwitch(o.id); }}
      />
      <div className="flex justify-between mt-1">
        {options.map((o, i) => (
          <button key={o.id} onClick={() => onSwitch(o.id)}
            className={cx('text-2xs truncate max-w-[70px] transition-colors', i === idx ? 'text-accent' : 'text-faint hover:text-ink')}>
            {o.name.replace(/^Option /, '')}
          </button>
        ))}
      </div>
      <div className="mt-2.5 space-y-1">
        {options.map((o) => (
          <button key={o.id} onClick={() => onSwitch(o.id)}
            className={cx('w-full rounded-md border px-2.5 py-1.5 text-left transition-colors',
              o.id === activeId ? 'border-accent bg-accent/5' : 'border-line hover:bg-hover')}>
            <span className="block text-xs text-ink truncate">{o.name}</span>
            <span className="block font-mono text-2xs text-muted tabular-nums">
              {o.area > 0 ? `${formatArea(o.area)} m² · ${formatArea(o.fabric)} m² fabric` : 'empty'}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
};

// ---------------------------------------------------------------- takeoff

export interface ShapeStat { index: number; area: number; report: MaterialReport; edge?: number }

export const TakeoffSection = ({ tentData, report, shapes, onPickEdge }: {
  tentData: TentData; report: MaterialReport; shapes: ShapeStat[]; onPickEdge?: (shapeIndex: number) => void;
}) => (
  <Section title="Takeoff">
    <Stat label="Floor area" value={formatArea(tentData.area)} unit="m²" />
    <Stat label="Fabric needed" value={formatArea(report.totalArea)} unit="m²" hint="1.5 m panels with 25 mm overlap" />
    <Stat label="Waste" value={formatArea(report.wasteArea)} unit="m²" />
    <Stat label="Panels" value={String(report.panelCount)} />
    {shapes.length > 0 && (
      <div className="mt-2.5 space-y-1.5">
        <div className="text-2xs uppercase tracking-wide text-faint">By shape</div>
        {shapes.map((s) => (
          <div key={s.index} className="rounded-md border border-line px-2.5 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink">Shape {s.index + 1}</span>
              {onPickEdge && (
                <button className="text-2xs text-accent hover:underline" onClick={() => onPickEdge(s.index)}>
                  {s.edge === undefined ? 'Pick direction' : `Edge ${s.edge + 1} · change`}
                </button>
              )}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 text-2xs text-muted font-mono tabular-nums">
              <span>Floor</span><span className="text-right text-ink">{formatArea(s.area)} m²</span>
              <span>Fabric</span><span className="text-right text-ink">{formatArea(s.report.totalArea)} m²</span>
              <span>Waste</span><span className="text-right text-ink">{formatArea(s.report.wasteArea)} m²</span>
              <span>Panels</span><span className="text-right text-ink">{s.report.panelCount}</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </Section>
);

// ---------------------------------------------------------------- frame

export const Inspector = ({ children, onClearAll, canClear }: { children: React.ReactNode; onClearAll: () => void; canClear: boolean }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <aside className="w-[280px] shrink-0 flex flex-col border-l border-line bg-panel min-h-0">
      <div className="flex-1 overflow-y-auto">{children}</div>
      <div className="p-3 border-t border-line">
        <Btn
          size="sm" variant="danger" className="w-full" disabled={!canClear}
          onClick={() => (armed ? (setArmed(false), onClearAll()) : setArmed(true))}
        >
          <Trash2 size={13} /> {armed ? 'Click again to clear the sketch' : 'Clear sketch, poles and furniture'}
        </Btn>
      </div>
    </aside>
  );
};
