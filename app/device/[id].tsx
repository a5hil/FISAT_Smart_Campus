import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Platform,
  Modal,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { FloatingBottomNav } from '../../components/FloatingBottomNav';
import { useApp, useTheme } from '../../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Stop,
  Rect,
  Path,
  Circle,
  G,
} from 'react-native-svg';

function hsvToHex(h: number, s: number, v: number): string {
  s = Math.max(0, Math.min(1, s / 100));
  v = Math.max(0, Math.min(1, v / 100));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else if (h >= 300 && h < 360) { r = c; g = 0; b = x; }
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  if (clean.length !== 6) return { h: 0, s: 100, v: 100 };
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : Math.round((d / max) * 100);
  const v = Math.round(max * 100);
  return { h, s, v };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  if (clean.length !== 6) return { r: 255, g: 107, b: 0 };
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

interface ChromaPanelColorStudioProps {
  currentColor: string;
  currentBrightness: number;
  currentMode: string;
  isOn: boolean;
  onColorChange: (hex: string) => void;
  onBrightnessChange: (brightness: number) => void;
  onModeChange: (mode: string) => void;
  onTogglePower: () => void;
  colors: any;
  isDark: boolean;
}

export function ChromaPanelColorStudio({
  currentColor,
  currentBrightness,
  currentMode,
  isOn,
  onColorChange,
  onBrightnessChange,
  onModeChange,
  onTogglePower,
  colors,
  isDark,
}: ChromaPanelColorStudioProps) {
  const [activeTab, setActiveTab] = useState<'wheel' | 'effects'>('wheel');
  const [formatMode, setFormatMode] = useState<'HEX' | 'RGB' | 'HSL'>('HEX');
  const [customHex, setCustomHex] = useState(currentColor);
  const [sliderWidth, setSliderWidth] = useState(300);

  const WHEEL_SIZE = 240;
  const RADIUS = 108;
  const CENTER = WHEEL_SIZE / 2;

  const currentHsv = useMemo(() => hexToHsv(currentColor), [currentColor]);
  const [hsv, setHsv] = useState(currentHsv);

  useEffect(() => {
    setHsv(hexToHsv(currentColor));
    setCustomHex(currentColor);
  }, [currentColor]);

  const rgb = useMemo(() => hexToRgb(currentColor), [currentColor]);
  const hsl = useMemo(() => rgbToHsl(rgb.r, rgb.g, rgb.b), [rgb]);

  // 96 High-definition SVG Chromatic Wedges with 0.1deg overlap for seamless color circle
  const svgWheelPaths = useMemo(() => {
    const NUM_SEGMENTS = 96;
    const paths = [];
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const theta1 = (i * 360) / NUM_SEGMENTS;
      const theta2 = ((i + 1.15) * 360) / NUM_SEGMENTS;
      const rad1 = (theta1 * Math.PI) / 180;
      const rad2 = (theta2 * Math.PI) / 180;

      // Red (0°) at exact top (12 o'clock)
      const x1 = CENTER + RADIUS * Math.sin(rad1);
      const y1 = CENTER - RADIUS * Math.cos(rad1);
      const x2 = CENTER + RADIUS * Math.sin(rad2);
      const y2 = CENTER - RADIUS * Math.cos(rad2);

      const d = `M ${CENTER} ${CENTER} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      const fill = hsvToHex((theta1 + theta2) / 2, 100, 100);
      paths.push({ d, fill, key: i });
    }
    return paths;
  }, [CENTER, RADIUS]);

  // Throttled Network Dispatch References
  const lastColorSendRef = useRef<number>(0);
  const colorThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBriSendRef = useRef<number>(0);
  const briThrottleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle color selection on wheel touch / drag
  const handleWheelTouch = (x: number, y: number, isFinal = false) => {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = Math.min(RADIUS, dist);

    // Angle clockwise from top (Red = 0°)
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;

    const sat = Math.min(100, Math.max(0, Math.round((r / RADIUS) * 100)));
    const hue = Math.round(deg) % 360;

    const nextHsv = { h: hue, s: sat, v: 100 };
    setHsv(nextHsv);
    const newHex = hsvToHex(nextHsv.h, nextHsv.s, nextHsv.v);
    setCustomHex(newHex);

    if (isFinal) {
      if (colorThrottleTimer.current) {
        clearTimeout(colorThrottleTimer.current);
        colorThrottleTimer.current = null;
      }
      lastColorSendRef.current = Date.now();
      onColorChange(newHex);
    } else {
      const now = Date.now();
      if (now - lastColorSendRef.current >= 45) {
        lastColorSendRef.current = now;
        if (colorThrottleTimer.current) {
          clearTimeout(colorThrottleTimer.current);
          colorThrottleTimer.current = null;
        }
        onColorChange(newHex);
      } else if (!colorThrottleTimer.current) {
        colorThrottleTimer.current = setTimeout(() => {
          colorThrottleTimer.current = null;
          lastColorSendRef.current = Date.now();
          onColorChange(newHex);
        }, 50);
      }
    }
  };

  const wheelPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleWheelTouch(evt.nativeEvent.locationX, evt.nativeEvent.locationY, false),
      onPanResponderMove: (evt) => handleWheelTouch(evt.nativeEvent.locationX, evt.nativeEvent.locationY, false),
      onPanResponderRelease: (evt) => handleWheelTouch(evt.nativeEvent.locationX, evt.nativeEvent.locationY, true),
      onPanResponderTerminate: (evt) => handleWheelTouch(evt.nativeEvent.locationX, evt.nativeEvent.locationY, true),
    })
  ).current;

  // Master Brightness Slider PanResponder with throttling
  const handleBrightnessSlide = (x: number, isFinal = false) => {
    if (sliderWidth <= 0) return;
    const clampedX = Math.max(0, Math.min(sliderWidth, x));
    const pct = Math.max(5, Math.round((clampedX / sliderWidth) * 100));

    if (isFinal) {
      if (briThrottleTimer.current) {
        clearTimeout(briThrottleTimer.current);
        briThrottleTimer.current = null;
      }
      lastBriSendRef.current = Date.now();
      onBrightnessChange(pct);
    } else {
      const now = Date.now();
      if (now - lastBriSendRef.current >= 45) {
        lastBriSendRef.current = now;
        if (briThrottleTimer.current) {
          clearTimeout(briThrottleTimer.current);
          briThrottleTimer.current = null;
        }
        onBrightnessChange(pct);
      } else if (!briThrottleTimer.current) {
        briThrottleTimer.current = setTimeout(() => {
          briThrottleTimer.current = null;
          lastBriSendRef.current = Date.now();
          onBrightnessChange(pct);
        }, 50);
      }
    }
  };

  const brightnessPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleBrightnessSlide(evt.nativeEvent.locationX, false),
      onPanResponderMove: (evt) => handleBrightnessSlide(evt.nativeEvent.locationX, false),
      onPanResponderRelease: (evt) => handleBrightnessSlide(evt.nativeEvent.locationX, true),
      onPanResponderTerminate: (evt) => handleBrightnessSlide(evt.nativeEvent.locationX, true),
    })
  ).current;

  // Color Temperature (Warm White / Cool Daylight) Slider
  const KELVIN_COLORS = ['#FFA54F', '#FFD1A4', '#FFE4CE', '#FFF8F0', '#FFFFFF', '#D6E8FF', '#A8D0FF'];
  const handleWarmthSlide = (x: number) => {
    if (sliderWidth <= 0) return;
    const clampedX = Math.max(0, Math.min(sliderWidth, x));
    const ratio = clampedX / sliderWidth;
    const idx = Math.min(KELVIN_COLORS.length - 1, Math.floor(ratio * KELVIN_COLORS.length));
    const chosenColor = KELVIN_COLORS[idx];
    onColorChange(chosenColor);
  };

  const warmthPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => handleWarmthSlide(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => handleWarmthSlide(evt.nativeEvent.locationX),
    })
  ).current;

  // Curated Chroma Palette Swatches (Matching WLED / Pro Chroma standards)
  const CHROMA_PALETTE_ROW1 = [
    { hex: '#FF1744', label: 'Crimson' },
    { hex: '#FF7A00', label: 'Amber Orange' },
    { hex: '#FFD700', label: 'Gold' },
    { hex: '#FFE4B5', label: 'Warm 2700K' },
    { hex: '#FFF8F0', label: 'Soft 4000K' },
    { hex: '#FFFFFF', label: 'Pure White' },
  ];

  const CHROMA_PALETTE_ROW2 = [
    { hex: '#FF007F', label: 'Vivid Pink' },
    { hex: '#8A2BE2', label: 'Purple' },
    { hex: '#2979FF', label: 'Electric Blue' },
    { hex: '#00E5FF', label: 'Neon Cyan' },
    { hex: '#00E676', label: 'Emerald Green' },
    { hex: '#18181B', label: 'Obsidian' },
  ];

  const CHROMA_EFFECTS = [
    { id: 'solid', name: 'Solid Chroma', icon: 'color-filter-outline', desc: 'Precise static chromatic illumination' },
    { id: 'breathe', name: 'Chroma Pulse', icon: 'pulse-outline', desc: 'Gentle rhythmic ambient breathing glow' },
    { id: 'rainbow', name: 'Full Spectrum Wave', icon: 'sparkles-outline', desc: 'Continuous 360° dynamic color cycle' },
    { id: 'strobe', name: 'Flash / Strobe', icon: 'flash-outline', desc: 'High visibility strobe beacon' },
    { id: 'chase', name: 'Color Chase', icon: 'swap-horizontal-outline', desc: 'Sequential flowing light stream' },
    { id: 'fire', name: 'Fireplace Flicker', icon: 'flame-outline', desc: 'Natural organic flame warmth' },
  ];

  const activeEffectObj = CHROMA_EFFECTS.find(e => e.id === currentMode) || CHROMA_EFFECTS[0];
  const dynamicStyles = getChromaDynamicStyles(colors, isDark);

  // Calculate Wheel Knob Position (Red 0° Top)
  const thetaRad = (hsv.h * Math.PI) / 180;
  const thumbRadius = (hsv.s / 100) * RADIUS;
  const wheelThumbX = CENTER + thumbRadius * Math.sin(thetaRad) - 12;
  const wheelThumbY = CENTER - thumbRadius * Math.cos(thetaRad) - 12;
  const briThumbX = Math.max(0, Math.min(sliderWidth - 20, (currentBrightness / 100) * sliderWidth - 10));

  return (
    <View style={dynamicStyles.panelContainer}>
      {/* ─── Chroma Header ─── */}
      <View style={dynamicStyles.panelHeaderRow}>
        <View style={dynamicStyles.panelTitleGroup}>
          <View style={[dynamicStyles.headerColorDot, { backgroundColor: currentColor }]} />
          <Text style={dynamicStyles.panelTitle}>CHROMA COLOR WHEEL</Text>
        </View>

        <TouchableOpacity
          style={dynamicStyles.activeModeBadge}
          onPress={() => setActiveTab(activeTab === 'wheel' ? 'effects' : 'wheel')}
          activeOpacity={0.7}
        >
          <Ionicons
            name={activeTab === 'wheel' ? 'sparkles-outline' : 'color-palette-outline'}
            size={13}
            color={colors.primary}
          />
          <Text style={dynamicStyles.activeModeBadgeText}>
            {activeTab === 'wheel' ? `Mode: ${activeEffectObj.name}` : 'Color Wheel'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ─── TAB 1: SVG Chroma Wheel & Sliders ─── */}
      {activeTab === 'wheel' && (
        <View style={dynamicStyles.wheelTabBody}>
          {/* 1. Continuous SVG Chroma Color Wheel */}
          <View style={dynamicStyles.wheelCenterWrapper}>
            <View
              style={[dynamicStyles.wheelTouchBox, { width: WHEEL_SIZE, height: WHEEL_SIZE }]}
              {...wheelPanResponder.panHandlers}
            >
              <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}>
                <Defs>
                  {/* Radial White Saturation Center Fade */}
                  <SvgRadialGradient id="chromaCenterFade" cx="50%" cy="50%" rx="50%" ry="50%" fx="50%" fy="50%">
                    <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
                    <Stop offset="25%" stopColor="#FFFFFF" stopOpacity="0.88" />
                    <Stop offset="65%" stopColor="#FFFFFF" stopOpacity="0.38" />
                    <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                  </SvgRadialGradient>
                </Defs>

                {/* 96 Chromatic Wedges */}
                <G>
                  {svgWheelPaths.map((p) => (
                    <Path key={p.key} d={p.d} fill={p.fill} />
                  ))}
                </G>

                {/* Concentric Saturation Overlay */}
                <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#chromaCenterFade)" />

                {/* Wheel Edge Rim */}
                <Circle
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS - 0.5}
                  stroke={colors.surfaceBorder}
                  strokeWidth="1.5"
                  fill="none"
                />
              </Svg>

              {/* Draggable Selector Knob Ring */}
              <View
                style={[
                  dynamicStyles.wheelThumbKnob,
                  { left: wheelThumbX, top: wheelThumbY },
                ]}
                pointerEvents="none"
              >
                <View style={[dynamicStyles.thumbInnerDot, { backgroundColor: currentColor }]} />
              </View>
            </View>
          </View>

          {/* 2. Master Luminance / Brightness Slider */}
          <View style={dynamicStyles.sliderBlock}>
            <View style={dynamicStyles.sliderLabelRow}>
              <View style={dynamicStyles.briLabelGroup}>
                <Ionicons name="sunny-outline" size={13} color={colors.textSecondary} />
                <Text style={dynamicStyles.sliderLabel}>Brightness</Text>
              </View>
              <Text style={dynamicStyles.sliderValueText}>{currentBrightness}%</Text>
            </View>

            <View
              style={dynamicStyles.sliderTrackBox}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                if (w > 0) setSliderWidth(w);
              }}
              {...brightnessPanResponder.panHandlers}
            >
              <Svg width="100%" height={16} style={dynamicStyles.svgSliderTrack}>
                <Defs>
                  <SvgLinearGradient id="chromaBriGrad" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#000000" />
                    <Stop offset="1" stopColor={currentColor} />
                  </SvgLinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" rx={8} ry={8} fill="url(#chromaBriGrad)" />
              </Svg>

              <View
                style={[
                  dynamicStyles.sliderThumbKnob,
                  { left: briThumbX, backgroundColor: '#FFFFFF' },
                ]}
                pointerEvents="none"
              />
            </View>
          </View>

          {/* 3. Warmth / White Temperature Balance Slider */}
          <View style={dynamicStyles.sliderBlock}>
            <View style={dynamicStyles.sliderLabelRow}>
              <View style={dynamicStyles.briLabelGroup}>
                <Ionicons name="thermometer-outline" size={13} color={colors.textSecondary} />
                <Text style={dynamicStyles.sliderLabel}>Warmth / White Balance</Text>
              </View>
              <Text style={dynamicStyles.sliderValueText}>2200K – 6500K</Text>
            </View>

            <View
              style={dynamicStyles.sliderTrackBox}
              {...warmthPanResponder.panHandlers}
            >
              <Svg width="100%" height={16} style={dynamicStyles.svgSliderTrack}>
                <Defs>
                  <SvgLinearGradient id="chromaWarmthGrad" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#FFA54F" />
                    <Stop offset="0.3" stopColor="#FFE4CE" />
                    <Stop offset="0.65" stopColor="#FFFFFF" />
                    <Stop offset="1" stopColor="#D6E8FF" />
                  </SvgLinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" rx={8} ry={8} fill="url(#chromaWarmthGrad)" />
              </Svg>
            </View>
          </View>

          {/* 4. Format Switcher & Value Inspector (HEX / RGB / HSL) */}
          <View style={dynamicStyles.inspectorCard}>
            <View style={dynamicStyles.formatTabsRow}>
              <View style={dynamicStyles.formatTogglePills}>
                {(['HEX', 'RGB', 'HSL'] as const).map((fmt) => (
                  <TouchableOpacity
                    key={fmt}
                    style={[
                      dynamicStyles.formatPill,
                      formatMode === fmt && dynamicStyles.formatPillActive,
                    ]}
                    onPress={() => setFormatMode(fmt)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        dynamicStyles.formatPillText,
                        formatMode === fmt && dynamicStyles.formatPillTextActive,
                      ]}
                    >
                      {fmt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={dynamicStyles.liveColorPill}>
                <View style={[dynamicStyles.previewDot, { backgroundColor: currentColor }]} />
                <Text style={dynamicStyles.liveHexText}>{currentColor.toUpperCase()}</Text>
              </View>
            </View>

            {/* Mode-Specific Field Render */}
            {formatMode === 'HEX' && (
              <View style={dynamicStyles.hexInputRow}>
                <TextInput
                  style={dynamicStyles.hexInput}
                  value={customHex}
                  onChangeText={(t) => setCustomHex(t.startsWith('#') ? t : `#${t}`)}
                  maxLength={7}
                  autoCapitalize="characters"
                  placeholder="#FF6B00"
                  placeholderTextColor={colors.inputPlaceholder}
                />
                <TouchableOpacity
                  style={dynamicStyles.hexSubmitBtn}
                  onPress={() => {
                    if (customHex.match(/^#[0-9A-Fa-f]{6}$/)) {
                      onColorChange(customHex);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={dynamicStyles.hexSubmitBtnText}>Apply</Text>
                </TouchableOpacity>
              </View>
            )}

            {formatMode === 'RGB' && (
              <View style={dynamicStyles.numericChipsRow}>
                <View style={dynamicStyles.numChip}>
                  <Text style={dynamicStyles.numChipLabel}>R</Text>
                  <Text style={dynamicStyles.numChipValue}>{rgb.r}</Text>
                </View>
                <View style={dynamicStyles.numChip}>
                  <Text style={dynamicStyles.numChipLabel}>G</Text>
                  <Text style={dynamicStyles.numChipValue}>{rgb.g}</Text>
                </View>
                <View style={dynamicStyles.numChip}>
                  <Text style={dynamicStyles.numChipLabel}>B</Text>
                  <Text style={dynamicStyles.numChipValue}>{rgb.b}</Text>
                </View>
              </View>
            )}

            {formatMode === 'HSL' && (
              <View style={dynamicStyles.numericChipsRow}>
                <View style={dynamicStyles.numChip}>
                  <Text style={dynamicStyles.numChipLabel}>H</Text>
                  <Text style={dynamicStyles.numChipValue}>{hsl.h}°</Text>
                </View>
                <View style={dynamicStyles.numChip}>
                  <Text style={dynamicStyles.numChipLabel}>S</Text>
                  <Text style={dynamicStyles.numChipValue}>{hsl.s}%</Text>
                </View>
                <View style={dynamicStyles.numChip}>
                  <Text style={dynamicStyles.numChipLabel}>L</Text>
                  <Text style={dynamicStyles.numChipValue}>{hsl.l}%</Text>
                </View>
              </View>
            )}
          </View>

          {/* 5. Chroma Curated Palette Swatches */}
          <View style={dynamicStyles.paletteSection}>
            <Text style={dynamicStyles.paletteHeading}>Quick Palette Swatches</Text>
            
            {/* Row 1 Swatches */}
            <View style={dynamicStyles.swatchesRow}>
              {CHROMA_PALETTE_ROW1.map((swatch) => {
                const isSelected = currentColor.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <TouchableOpacity
                    key={swatch.hex}
                    style={[
                      dynamicStyles.swatchPill,
                      { backgroundColor: swatch.hex },
                      isSelected && dynamicStyles.swatchPillSelected,
                    ]}
                    onPress={() => onColorChange(swatch.hex)}
                    activeOpacity={0.8}
                  />
                );
              })}
            </View>

            {/* Row 2 Swatches */}
            <View style={dynamicStyles.swatchesRow}>
              {CHROMA_PALETTE_ROW2.map((swatch) => {
                const isSelected = currentColor.toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <TouchableOpacity
                    key={swatch.hex}
                    style={[
                      dynamicStyles.swatchPill,
                      { backgroundColor: swatch.hex },
                      isSelected && dynamicStyles.swatchPillSelected,
                    ]}
                    onPress={() => onColorChange(swatch.hex)}
                    activeOpacity={0.8}
                  />
                );
              })}
            </View>
          </View>
        </View>
      )}

      {/* ─── TAB 2: Dynamic Lighting Effects ─── */}
      {activeTab === 'effects' && (
        <View style={dynamicStyles.effectsTabBody}>
          <Text style={dynamicStyles.effectsHeading}>Dynamic Animation Modes</Text>
          <View style={dynamicStyles.effectsList}>
            {CHROMA_EFFECTS.map((eff) => {
              const isActive = currentMode === eff.id;
              return (
                <TouchableOpacity
                  key={eff.id}
                  style={[
                    dynamicStyles.effectCard,
                    isActive && dynamicStyles.effectCardActive,
                  ]}
                  onPress={() => onModeChange(eff.id)}
                  activeOpacity={0.75}
                >
                  <View style={[dynamicStyles.effectIconBox, isActive && dynamicStyles.effectIconBoxActive]}>
                    <Ionicons
                      name={eff.icon as any}
                      size={18}
                      color={isActive ? (isDark ? '#000000' : '#FFFFFF') : colors.textSecondary}
                    />
                  </View>
                  <View style={dynamicStyles.effectInfoBox}>
                    <Text style={[dynamicStyles.effectName, isActive && dynamicStyles.effectNameActive]}>
                      {eff.name}
                    </Text>
                    <Text style={dynamicStyles.effectDesc}>{eff.desc}</Text>
                  </View>
                  {isActive && (
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* ─── Bottom Studio Tab Navigation (Wheel | Effects) ─── */}
      <View style={dynamicStyles.bottomNavRow}>
        <TouchableOpacity
          style={[dynamicStyles.tabBtn, activeTab === 'wheel' && dynamicStyles.tabBtnActive]}
          onPress={() => setActiveTab('wheel')}
          activeOpacity={0.75}
        >
          <Ionicons
            name="color-palette-outline"
            size={16}
            color={activeTab === 'wheel' ? (isDark ? '#FFFFFF' : colors.primary) : colors.textMuted}
          />
          <Text style={[dynamicStyles.tabBtnText, activeTab === 'wheel' && dynamicStyles.tabBtnTextActive]}>
            Chroma Wheel
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[dynamicStyles.tabBtn, activeTab === 'effects' && dynamicStyles.tabBtnActive]}
          onPress={() => setActiveTab('effects')}
          activeOpacity={0.75}
        >
          <Ionicons
            name="sparkles-outline"
            size={16}
            color={activeTab === 'effects' ? (isDark ? '#FFFFFF' : colors.primary) : colors.textMuted}
          />
          <Text style={[dynamicStyles.tabBtnText, activeTab === 'effects' && dynamicStyles.tabBtnTextActive]}>
            Lighting Modes
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function getChromaDynamicStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    panelContainer: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 16,
    },
    panelHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    panelTitleGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerColorDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    panelTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1,
    },
    activeModeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    activeModeBadgeText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    wheelTabBody: {
      gap: 14,
      alignItems: 'center',
      width: '100%',
    },
    // SVG Circular Chroma Wheel
    wheelCenterWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 4,
    },
    wheelTouchBox: {
      position: 'relative',
      borderRadius: 120,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    wheelThumbKnob: {
      position: 'absolute',
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2.5,
      borderColor: '#FFFFFF',
      backgroundColor: '#000000',
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
    },
    thumbInnerDot: {
      width: 9,
      height: 9,
      borderRadius: 4.5,
    },
    // Sliders
    sliderBlock: {
      width: '100%',
      gap: 6,
    },
    sliderLabelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    briLabelGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    sliderLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    sliderValueText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '700',
    },
    sliderTrackBox: {
      height: 24,
      justifyContent: 'center',
      position: 'relative',
      width: '100%',
    },
    svgSliderTrack: {
      width: '100%',
      height: 16,
      borderRadius: 8,
    },
    sliderThumbKnob: {
      position: 'absolute',
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: '#FFFFFF',
      top: 2,
      elevation: 3,
    },
    // Inspector
    inspectorCard: {
      width: '100%',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : colors.cardSecondary,
      borderRadius: Layout.radius.md,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 10,
    },
    formatTabsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    formatTogglePills: {
      flexDirection: 'row',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
      borderRadius: 6,
      padding: 2,
      gap: 2,
    },
    formatPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
    },
    formatPillActive: {
      backgroundColor: colors.primary,
    },
    formatPillText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    formatPillTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
    },
    liveColorPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    previewDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    liveHexText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    hexInputRow: {
      flexDirection: 'row',
      gap: 8,
    },
    hexInput: {
      flex: 1,
      height: 34,
      backgroundColor: colors.inputBackground,
      borderRadius: Layout.radius.sm,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
      paddingHorizontal: 10,
      letterSpacing: 1,
    },
    hexSubmitBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      height: 34,
      borderRadius: Layout.radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hexSubmitBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 12,
      fontWeight: '700',
    },
    numericChipsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    numChip: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
      borderRadius: 6,
      paddingVertical: 6,
      paddingHorizontal: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    numChipLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    numChipValue: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
    // Swatches
    paletteSection: {
      width: '100%',
      gap: 8,
    },
    paletteHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    swatchesRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
    },
    swatchPill: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1.5,
      borderColor: colors.surfaceBorder,
    },
    swatchPillSelected: {
      borderColor: colors.primary,
      borderWidth: 2.5,
      transform: [{ scale: 1.15 }],
    },
    // Effects Tab
    effectsTabBody: {
      gap: 8,
      paddingVertical: 4,
    },
    effectsHeading: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      marginBottom: 6,
    },
    effectsList: {
      gap: 8,
    },
    effectCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : colors.cardSecondary,
      borderRadius: Layout.radius.md,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 12,
    },
    effectCardActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)',
    },
    effectIconBox: {
      width: 34,
      height: 34,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    effectIconBoxActive: {
      backgroundColor: colors.primary,
    },
    effectInfoBox: {
      flex: 1,
    },
    effectName: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    effectNameActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    effectDesc: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    // Bottom Tab switcher
    bottomNavRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 14,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    tabBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
      gap: 6,
    },
    tabBtnActive: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
    },
    tabBtnText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    tabBtnTextActive: {
      color: isDark ? '#FFFFFF' : colors.primary,
      fontWeight: '700',
    },
  });
}

export default function DeviceDetailScreen() {
  const { id, classroomId } = useLocalSearchParams<{ id: string; classroomId: string }>();
  const { classrooms, toggleDevice, updateDeviceValue, esp32Connected, esp32Ip, updateDeviceRatedPower, updateDeviceSchedule } = useApp();
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const classroom = classroomId
    ? classrooms.find(c => c.id === classroomId)
    : classrooms.find(c => c.devices.some(d => d.id === id));
  const device = classroom?.devices.find(d => d.id === id);

  if (!classroom || !device) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Device Not Found" showBack />
        <View style={styles.emptyState}>
          <Ionicons name="hardware-chip-outline" size={64} color={Colors.surfaceTranslucent} />
          <Text style={styles.emptyTitle}>Device not found</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const isOn = device.status === 'on';
  const isOffline = device.status === 'offline';
  const isCurtain = device.category === 'curtain';
  const isFan = device.category === 'fan';
  const isRgb = device.id.includes('rgb') || device.id.includes('strip') || Boolean(device.capabilities?.color);

  const currentColor = device.color || '#FF6B00';
  const currentBrightness = device.brightness ?? 80;
  const currentRgbMode = device.rgbMode || device.mode || 'solid';
  const [selectedRgbMode, setSelectedRgbMode] = useState<string>(currentRgbMode);
  const lastUserModeSelectMsRef = useRef<number>(0);

  useEffect(() => {
    // Only synchronize from background device updates if user hasn't actively switched mode in last 4s
    if (device.rgbMode && Date.now() - lastUserModeSelectMsRef.current > 4000) {
      setSelectedRgbMode(device.rgbMode);
    }
  }, [device.rgbMode]);

  const [customHex, setCustomHex] = useState(currentColor);

  useEffect(() => {
    setCustomHex(currentColor);
  }, [currentColor]);

  const defaultRated = isRgb ? 4.5 : isFan ? 75 : device.category === 'light' ? 60 : 40;
  const currentRated = device.ratedPower || defaultRated;
  const [editingLoad, setEditingLoad] = useState(false);
  const [inputWatts, setInputWatts] = useState(String(currentRated));
  const [savingWatts, setSavingWatts] = useState(false);

  useEffect(() => {
    setInputWatts(String(currentRated));
  }, [currentRated]);

  // Schedule & Automation State
  const initialSchedule = device.schedule;
  const [scheduleEnabled, setScheduleEnabled] = useState(initialSchedule?.enabled ?? false);
  const [onTime, setOnTime] = useState(initialSchedule?.onTime || '08:30');
  const [offTime, setOffTime] = useState(initialSchedule?.offTime || '17:00');
  const [selectedDays, setSelectedDays] = useState<number[]>(initialSchedule?.days || [1, 2, 3, 4, 5]);
  const [autoOffEnabled, setAutoOffEnabled] = useState(initialSchedule?.autoOffEnabled ?? false);
  const [autoOffMinutes, setAutoOffMinutes] = useState(initialSchedule?.autoOffMinutes || 60);

  // Time Picker State
  const [activePicker, setActivePicker] = useState<'on' | 'off' | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState<Date>(new Date());

  // Prevent background polling from overwriting in-flight user edits
  const prevDeviceIdRef = useRef(device.id);
  useEffect(() => {
    if (prevDeviceIdRef.current !== device.id) {
      prevDeviceIdRef.current = device.id;
      if (device.schedule) {
        setScheduleEnabled(device.schedule.enabled);
        if (device.schedule.onTime) setOnTime(device.schedule.onTime);
        if (device.schedule.offTime) setOffTime(device.schedule.offTime);
        if (device.schedule.days) setSelectedDays(device.schedule.days);
        if (device.schedule.autoOffEnabled !== undefined) setAutoOffEnabled(device.schedule.autoOffEnabled);
        if (device.schedule.autoOffMinutes !== undefined) setAutoOffMinutes(device.schedule.autoOffMinutes);
      }
    }
  }, [device.id, device.schedule]);

  const timeStringToDate = (timeStr: string): Date => {
    const parts = (timeStr || '08:00').split(':');
    const d = new Date();
    d.setHours(parseInt(parts[0] || '8', 10), parseInt(parts[1] || '0', 10), 0, 0);
    return d;
  };

  const dateToTimeString = (date: Date): string => {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  const handleTimeConfirmed = (target: 'on' | 'off', newTimeStr: string) => {
    const nextOn = target === 'on' ? newTimeStr : onTime;
    const nextOff = target === 'off' ? newTimeStr : offTime;
    if (target === 'on') setOnTime(newTimeStr);
    else setOffTime(newTimeStr);

    updateDeviceSchedule(classroom.id, device.id, {
      enabled: scheduleEnabled,
      onTime: nextOn,
      offTime: nextOff,
      days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5],
      autoOffEnabled,
      autoOffMinutes,
      autoOffStartedAt: device.schedule?.autoOffStartedAt ?? null,
    });
  };

  const openTimePicker = (target: 'on' | 'off') => {
    const initialDate = timeStringToDate(target === 'on' ? onTime : offTime);
    setTempPickerDate(initialDate);

    if (Platform.OS === 'android') {
      try {
        DateTimePickerAndroid.open({
          value: initialDate,
          mode: 'time',
          is24Hour: false,
          onValueChange: (_event: DateTimePickerChangeEvent, selectedDate?: Date) => {
            if (selectedDate) {
              const formatted = dateToTimeString(selectedDate);
              handleTimeConfirmed(target, formatted);
            }
          },
          onDismiss: () => {},
        });
        return;
      } catch (e) {
        console.warn('DateTimePickerAndroid open fallback', e);
      }
    }

    setActivePicker(target);
  };

  const adjustTime = (timeStr: string, deltaHours: number, deltaMins: number): string => {
    const parts = (timeStr || '08:00').split(':');
    let h = parseInt(parts[0] || '8', 10);
    let m = parseInt(parts[1] || '0', 10);
    m += deltaMins;
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    } else if (m < 0) {
      const borrow = Math.ceil(Math.abs(m) / 60);
      h -= borrow;
      m = (m + borrow * 60) % 60;
    }
    h = (h + deltaHours) % 24;
    if (h < 0) h += 24;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const formatTime12h = (timeStr: string): string => {
    const parts = (timeStr || '08:00').split(':');
    const h = parseInt(parts[0] || '0', 10);
    const m = parseInt(parts[1] || '0', 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const toggleDay = (dayNum: number) => {
    if (selectedDays.includes(dayNum)) {
      if (selectedDays.length > 1) {
        setSelectedDays(selectedDays.filter(d => d !== dayNum));
      }
    } else {
      setSelectedDays([...selectedDays, dayNum].sort());
    }
  };

  const handleSaveSchedule = (overrideEnabled?: boolean, overrideAutoOff?: boolean) => {
    const nextEnabled = overrideEnabled !== undefined ? overrideEnabled : scheduleEnabled;
    const nextAutoOff = overrideAutoOff !== undefined ? overrideAutoOff : autoOffEnabled;
    updateDeviceSchedule(classroom.id, device.id, {
      enabled: nextEnabled,
      onTime,
      offTime,
      days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5],
      autoOffEnabled: nextAutoOff,
      autoOffMinutes,
      autoOffStartedAt: device.schedule?.autoOffStartedAt ?? null,
    });
  };

  const getAutoOffCountdownText = () => {
    if (!autoOffEnabled) return null;
    if (isOn && device.schedule?.autoOffStartedAt) {
      const started = new Date(device.schedule.autoOffStartedAt).getTime();
      const elapsedMins = (Date.now() - started) / (1000 * 60);
      const remaining = Math.max(0, Math.ceil(autoOffMinutes - elapsedMins));
      return `Shutoff in ~${remaining} min`;
    }
    return `Arms on next power ON (${autoOffMinutes}m)`;
  };

  const handleColorChange = (hex: string) => {
    // If the strip is in an animation mode that overrides color (e.g. fireplace flicker or rainbow wave),
    // selecting a specific chromatic hue on the color wheel intelligently switches to 'solid' mode
    const nextMode = (selectedRgbMode === 'fire' || selectedRgbMode === 'rainbow') ? 'solid' : selectedRgbMode;
    if (nextMode !== selectedRgbMode) {
      lastUserModeSelectMsRef.current = Date.now();
      setSelectedRgbMode(nextMode);
    }
    updateDeviceValue(classroom.id, device.id, { color: hex, rgbMode: nextMode, status: 'on' });
  };

  const handleBrightnessChange = (val: number) => {
    const clamped = Math.max(10, Math.min(100, Math.round(val)));
    updateDeviceValue(classroom.id, device.id, { brightness: clamped, status: 'on' });
  };

  const handleModeChange = (mode: string) => {
    lastUserModeSelectMsRef.current = Date.now();
    setSelectedRgbMode(mode);
    updateDeviceValue(classroom.id, device.id, { rgbMode: mode, status: 'on' });
  };

  const RGB_PRESETS = [
    { label: 'Amber', hex: '#FF6B00' },
    { label: 'Candle', hex: '#FFA54F' },
    { label: 'Warm Wht', hex: '#FFF2DF' },
    { label: 'Cool Wht', hex: '#E0F7FA' },
    { label: 'Cyan', hex: '#00E5FF' },
    { label: 'Blue', hex: '#2979FF' },
    { label: 'Indigo', hex: '#536DFE' },
    { label: 'Purple', hex: '#9C27B0' },
    { label: 'Rose', hex: '#FF1493' },
    { label: 'Crimson', hex: '#FF1744' },
    { label: 'Orange', hex: '#FF3D00' },
    { label: 'Gold', hex: '#FFD600' },
    { label: 'Lime', hex: '#AEEA00' },
    { label: 'Emerald', hex: '#00E676' },
  ];

  const RGB_MODES = [
    { id: 'solid', label: 'Solid Color', icon: 'color-filter-outline' },
    { id: 'breathe', label: 'Pulse / Breathe', icon: 'pulse-outline' },
    { id: 'rainbow', label: 'Rainbow Wave', icon: 'sparkles-outline' },
    { id: 'strobe', label: 'Flash Alert', icon: 'flash-outline' },
  ];

  const getPresets = () => {
    if (isRgb) {
      return [
        { label: '2.5W Eco', watts: 2.5 },
        { label: '4.5W Std', watts: 4.5 },
        { label: '9W High', watts: 9 },
      ];
    }
    if (device.category === 'light') {
      return [
        { label: '15W LED', watts: 15 },
        { label: '28W Tube', watts: 28 },
        { label: '40W Panel', watts: 40 },
        { label: '60W Std', watts: 60 },
        { label: '100W High', watts: 100 },
      ];
    }
    if (device.category === 'fan') {
      return [
        { label: '28W BLDC', watts: 28 },
        { label: '45W Eco', watts: 45 },
        { label: '60W Med', watts: 60 },
        { label: '75W Std', watts: 75 },
      ];
    }
    if (device.category === 'curtain') {
      return [
        { label: '3W Idle', watts: 3 },
        { label: '5W Servo', watts: 5 },
        { label: '15W Motor', watts: 15 },
      ];
    }
    return [
      { label: '20W', watts: 20 },
      { label: '40W', watts: 40 },
      { label: '75W', watts: 75 },
      { label: '150W', watts: 150 },
    ];
  };

  const handleSaveWatts = async (val?: number) => {
    const targetWatts = val !== undefined ? val : parseFloat(inputWatts);
    if (isNaN(targetWatts) || targetWatts < 0 || targetWatts > 5000) return;
    setSavingWatts(true);
    await updateDeviceRatedPower(classroom.id, device.id, targetWatts);
    setSavingWatts(false);
    setInputWatts(String(targetWatts));
    setEditingLoad(false);
  };

  const getIcon = () => {
    if (isRgb) return 'color-palette-outline';
    switch (device.category) {
      case 'light': return 'bulb';
      case 'fan': return 'hardware-chip';
      case 'curtain': return 'apps';
      default: return 'power';
    }
  };

  const getCircuitChannel = () => {
    if (classroom.id.includes('101') || classroom.id === 'cls-a101') {
      if (device.category === 'light') return 'Main Lighting Line 1';
      if (device.category === 'fan') return 'Ceiling Fan Circuit 1';
      if (device.category === 'curtain') return 'Motorized Blind Actuator 1';
    }
    if (classroom.id.includes('102') || classroom.id === 'cls-a102') {
      if (device.category === 'light') return 'Main Lighting Line 2';
      if (device.category === 'fan') return 'Ceiling Fan Circuit 2';
      if (device.category === 'curtain') return 'Motorized Blind Actuator 2';
    }
    if (classroom.id.includes('corr') || classroom.id === 'cls-corridor') {
      if (isRgb) return 'GPIO 5 (WS2812B DIN Line)';
      if (device.id.includes('2')) return 'Corridor Line 2';
      return 'Corridor Line 1';
    }
    return `Smart Line #${device.relayChannel}`;
  };

  const getStatusLabel = () => {
    if (isOffline) return 'OFFLINE';
    if (isCurtain) return isOn ? 'OPEN (90°)' : 'CLOSED (0°)';
    if (isFan) return isOn ? 'RUNNING' : 'STOPPED';
    if (isRgb) return isOn ? 'POWERED ON' : 'TURNED OFF';
    return isOn ? 'POWERED ON' : 'TURNED OFF';
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title={device.name} showBack />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Main Power / Position Card */}
        <View style={styles.powerCard}>
          <View style={styles.powerCardHeader}>
            <View style={[
              styles.deviceIconLarge, 
              isOn && styles.deviceIconLargeActive,
            ]}>
              <Ionicons
                name={getIcon() as any}
                size={26}
                color={isOn ? colors.primary : colors.textMuted}
              />
            </View>
            <View style={styles.powerInfo}>
              <Text style={styles.deviceName}>{device.name}</Text>
              <Text style={styles.deviceLocation}>{classroom.name} • {device.roomArea}</Text>
              <View style={styles.statusBadgeRow}>
                <View style={[styles.dot, { backgroundColor: isOffline ? colors.critical : isOn ? colors.success : colors.textMuted }]} />
                <Text style={[styles.statusText, { color: isOffline ? colors.critical : isOn ? colors.success : colors.textMuted }]}>
                  {getStatusLabel()}
                </Text>
              </View>
            </View>
          </View>

          {/* Unified Manual Power Controls */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionButton, isOn && styles.actionButtonActive]}
              onPress={() => {
                if (!isOn) toggleDevice(classroom.id, device.id);
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isCurtain ? 'scan-outline' : 'power'}
                size={17}
                color={isOn ? (isDark ? '#000000' : '#FFFFFF') : colors.text}
              />
              <Text style={[styles.actionButtonText, isOn && styles.actionButtonTextActive]}>
                {isCurtain ? 'Open Curtain' : 'Turn On'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, !isOn && styles.actionButtonActive]}
              onPress={() => {
                if (isOn) toggleDevice(classroom.id, device.id);
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isCurtain ? 'close-circle-outline' : 'power-outline'}
                size={17}
                color={!isOn ? (isDark ? '#000000' : '#FFFFFF') : colors.text}
              />
              <Text style={[styles.actionButtonText, !isOn && styles.actionButtonTextActive]}>
                {isCurtain ? 'Close Curtain' : 'Turn Off'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Chroma Panel Color Studio (2D Canvas, Sliders, Palette, Format Switcher, Effects) ─── */}
        {isRgb && (
          <ChromaPanelColorStudio
            currentColor={currentColor}
            currentBrightness={currentBrightness}
            currentMode={selectedRgbMode}
            isOn={isOn}
            onColorChange={handleColorChange}
            onBrightnessChange={handleBrightnessChange}
            onModeChange={handleModeChange}
            onTogglePower={() => toggleDevice(classroom.id, device.id)}
            colors={colors}
            isDark={isDark}
          />
        )}

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Current Draw</Text>
            <Text style={[styles.statValue, { color: isOn ? colors.primary : colors.text }]}>
              {device.powerUsage || 0}W
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Rated Load</Text>
            <Text style={styles.statValue}>{currentRated}W</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Today</Text>
            <Text style={styles.statValue}>
              {device.energyToday < 1 ? device.energyToday.toFixed(3) : device.energyToday.toFixed(2)} kWh
            </Text>
          </View>
        </View>

        {/* User-Customizable Rated Power Specification */}
        <View style={styles.loadCard}>
          <View style={styles.loadHeader}>
            <View style={styles.loadTitleRow}>
              <View style={styles.loadIconBox}>
                <Ionicons name="flash-outline" size={20} color={colors.primary} />
              </View>
              <View style={styles.loadTextContainer}>
                <Text style={styles.loadCardTitle} numberOfLines={1}>Rated Power Specification</Text>
                <Text style={styles.loadCardSubtitle} numberOfLines={2}>
                  Custom appliance rating used for energy calculations
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={styles.editLoadBtn}
              onPress={() => {
                setInputWatts(String(currentRated));
                setEditingLoad(!editingLoad);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name={editingLoad ? "close-outline" : "create-outline"} size={16} color={colors.primary} />
              <Text style={styles.editLoadBtnText}>{editingLoad ? "Cancel" : "Edit Rating"}</Text>
            </TouchableOpacity>
          </View>

          {/* Current rating display */}
          <View style={styles.loadValueRow}>
            <Text style={styles.loadValueLabel}>Nameplate Rating:</Text>
            <Text style={styles.loadValueText}>{currentRated} <Text style={{ fontSize: 13, color: colors.textMuted }}>Watts</Text></Text>
          </View>

          {/* Interactive Edit / Preset Section */}
          {editingLoad && (
            <View style={styles.loadEditContainer}>
              <Text style={styles.loadEditLabel}>Quick Presets:</Text>
              <View style={styles.presetsRow}>
                {getPresets().map(p => (
                  <TouchableOpacity
                    key={p.watts}
                    style={[styles.presetChip, currentRated === p.watts && styles.presetChipActive]}
                    onPress={() => handleSaveWatts(p.watts)}
                    disabled={savingWatts}
                  >
                    <Text style={[styles.presetChipText, currentRated === p.watts && styles.presetChipTextActive]}>
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.loadEditLabel, { marginTop: 14 }]}>Custom Wattage (Watts):</Text>
              <View style={styles.customInputRow}>
                <TouchableOpacity 
                  style={styles.stepBtn}
                  onPress={() => {
                    const current = parseInt(inputWatts, 10) || currentRated;
                    const next = Math.max(1, current - 5);
                    setInputWatts(String(next));
                  }}
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </TouchableOpacity>

                <TextInput
                  style={styles.loadInput}
                  value={inputWatts}
                  onChangeText={setInputWatts}
                  keyboardType="numeric"
                  placeholder="e.g. 45"
                  placeholderTextColor={colors.inputPlaceholder}
                />

                <TouchableOpacity 
                  style={styles.stepBtn}
                  onPress={() => {
                    const current = parseInt(inputWatts, 10) || currentRated;
                    const next = current + 5;
                    setInputWatts(String(next));
                  }}
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.saveWattsBtn}
                  onPress={() => handleSaveWatts()}
                  disabled={savingWatts}
                  activeOpacity={0.8}
                >
                  <Text style={styles.saveWattsBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Power Schedule & Automation Card */}
        <View style={styles.scheduleCard}>
          {/* Header with Master Toggle */}
          <View style={styles.scheduleHeader}>
            <View style={styles.scheduleTitleRow}>
              <View style={styles.scheduleIconBox}>
                <Ionicons name="time" size={20} color={colors.primary} />
              </View>
              <View style={styles.scheduleTextContainer}>
                <Text style={styles.scheduleCardTitle}>Power Schedule & Automation</Text>
                <Text style={styles.scheduleCardSubtitle}>
                  Scheduled power cycles & automated shutoff
                </Text>
              </View>
            </View>
            <Switch
              value={scheduleEnabled}
              onValueChange={(val) => {
                setScheduleEnabled(val);
                handleSaveSchedule(val, undefined);
              }}
              trackColor={{ false: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)', true: colors.primary }}
              thumbColor={scheduleEnabled ? '#FFFFFF' : (isDark ? '#D1D5DB' : '#FFFFFF')}
            />
          </View>

          {/* Quick Schedule Presets */}
          <View style={styles.scheduleSection}>
            <Text style={styles.scheduleSectionLabel}>Operating Hours Preset:</Text>
            <View style={styles.schedulePresetsRow}>
              {[
                { label: 'School (8:30 - 16:30)', on: '08:30', off: '16:30' },
                { label: 'Morning (07:00 - 13:00)', on: '07:00', off: '13:00' },
                { label: 'Evening (16:00 - 21:00)', on: '16:00', off: '21:00' },
                { label: 'Full Day (08:00 - 20:00)', on: '08:00', off: '20:00' },
              ].map(preset => {
                const isActive = onTime === preset.on && offTime === preset.off;
                return (
                  <TouchableOpacity
                    key={preset.label}
                    style={[styles.schedulePresetChip, isActive && styles.schedulePresetChipActive]}
                    onPress={() => {
                      setOnTime(preset.on);
                      setOffTime(preset.off);
                      updateDeviceSchedule(classroom.id, device.id, {
                        enabled: scheduleEnabled,
                        onTime: preset.on,
                        offTime: preset.off,
                        days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5],
                        autoOffEnabled,
                        autoOffMinutes,
                        autoOffStartedAt: device.schedule?.autoOffStartedAt ?? null,
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.schedulePresetChipText, isActive && styles.schedulePresetChipTextActive]}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Time Setters: ON and OFF */}
          <View style={styles.timeSetterRow}>
            {/* Turn ON Time Box */}
            <TouchableOpacity 
              style={styles.timePickerCard}
              onPress={() => openTimePicker('on')}
              activeOpacity={0.75}
            >
              <View style={styles.timeSetterBoxHeader}>
                <Ionicons name="power" size={14} color={colors.success} />
                <Text style={styles.timeSetterBoxTitle}>POWER ON AT</Text>
              </View>
              <Text style={styles.timeDisplayBig}>{formatTime12h(onTime)}</Text>
              <Text style={styles.timeDisplaySub}>{onTime} (24-Hour)</Text>
              
              <View style={styles.pickTimeActionRow}>
                <Ionicons name="time-outline" size={14} color={colors.primary} />
                <Text style={styles.pickTimeActionText}>Pick Time</Text>
              </View>
            </TouchableOpacity>

            {/* Turn OFF Time Box */}
            <TouchableOpacity 
              style={styles.timePickerCard}
              onPress={() => openTimePicker('off')}
              activeOpacity={0.75}
            >
              <View style={styles.timeSetterBoxHeader}>
                <Ionicons name="power" size={14} color={colors.critical} />
                <Text style={styles.timeSetterBoxTitle}>POWER OFF AT</Text>
              </View>
              <Text style={styles.timeDisplayBig}>{formatTime12h(offTime)}</Text>
              <Text style={styles.timeDisplaySub}>{offTime} (24-Hour)</Text>
              
              <View style={styles.pickTimeActionRow}>
                <Ionicons name="time-outline" size={14} color={colors.primary} />
                <Text style={styles.pickTimeActionText}>Pick Time</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Active Days Selector */}
          <View style={styles.scheduleSection}>
            <View style={styles.daysHeaderRow}>
              <Text style={styles.scheduleSectionLabel}>Active Days:</Text>
              <View style={styles.daysPresetRow}>
                <TouchableOpacity
                  onPress={() => setSelectedDays([1, 2, 3, 4, 5])}
                  style={styles.dayFilterBtn}
                >
                  <Text style={styles.dayFilterBtnText}>Weekdays</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSelectedDays([1, 2, 3, 4, 5, 6, 7])}
                  style={styles.dayFilterBtn}
                >
                  <Text style={styles.dayFilterBtnText}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSelectedDays([6, 7])}
                  style={styles.dayFilterBtn}
                >
                  <Text style={styles.dayFilterBtnText}>Weekends</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.daysChipsRow}>
              {[
                { day: 1, label: 'Mon' },
                { day: 2, label: 'Tue' },
                { day: 3, label: 'Wed' },
                { day: 4, label: 'Thu' },
                { day: 5, label: 'Fri' },
                { day: 6, label: 'Sat' },
                { day: 7, label: 'Sun' },
              ].map(d => {
                const isSelected = selectedDays.includes(d.day);
                return (
                  <TouchableOpacity
                    key={d.day}
                    style={[styles.dayChip, isSelected && styles.dayChipActive]}
                    onPress={() => toggleDay(d.day)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.dayChipText, isSelected && styles.dayChipTextActive]}>
                      {d.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Auto-Off Countdown Timer Section */}
          <View style={styles.autoOffDivider} />
          
          <View style={styles.autoOffHeaderRow}>
            <View style={styles.autoOffTitleCol}>
              <View style={styles.autoOffTitleRow}>
                <Ionicons name="timer-outline" size={17} color={colors.primary} />
                <Text style={styles.autoOffTitle}>Auto-Off Countdown Timer</Text>
              </View>
              <Text style={styles.autoOffSubtitle}>
                Automatically shuts off appliance after continuous run
              </Text>
            </View>
            <Switch
              value={autoOffEnabled}
              onValueChange={(val) => {
                setAutoOffEnabled(val);
                handleSaveSchedule(undefined, val);
              }}
              trackColor={{ false: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)', true: colors.primary }}
              thumbColor={autoOffEnabled ? '#FFFFFF' : (isDark ? '#D1D5DB' : '#FFFFFF')}
            />
          </View>

          {autoOffEnabled && (
            <View style={styles.autoOffBody}>
              <Text style={styles.scheduleSectionLabel}>Shutoff Duration:</Text>
              <View style={styles.autoOffChipsRow}>
                {[
                  { label: '15m', minutes: 15 },
                  { label: '30m', minutes: 30 },
                  { label: '45m', minutes: 45 },
                  { label: '1h', minutes: 60 },
                  { label: '2h', minutes: 120 },
                  { label: '3h', minutes: 180 },
                ].map(item => {
                  const isCurrent = autoOffMinutes === item.minutes;
                  return (
                    <TouchableOpacity
                      key={item.minutes}
                      style={[styles.autoOffChip, isCurrent && styles.autoOffChipActive]}
                      onPress={() => {
                        setAutoOffMinutes(item.minutes);
                        updateDeviceSchedule(classroom.id, device.id, {
                          enabled: scheduleEnabled,
                          onTime,
                          offTime,
                          days: selectedDays.length > 0 ? selectedDays : [1, 2, 3, 4, 5],
                          autoOffEnabled: true,
                          autoOffMinutes: item.minutes,
                          autoOffStartedAt: device.schedule?.autoOffStartedAt ?? null,
                        });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.autoOffChipText, isCurrent && styles.autoOffChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {Boolean(getAutoOffCountdownText()) && (
                <View style={styles.autoOffLiveStatus}>
                  <Ionicons 
                    name={isOn ? "flash-outline" : "shield-checkmark-outline"} 
                    size={14} 
                    color={isOn ? colors.warning : colors.success} 
                  />
                  <Text style={[styles.autoOffLiveText, { color: isOn ? colors.warning : colors.success }]}>
                    {getAutoOffCountdownText()}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Save Schedule Action Button */}
          <TouchableOpacity
            style={styles.saveScheduleBtn}
            onPress={() => handleSaveSchedule()}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color={isDark ? '#000000' : '#FFFFFF'} />
            <Text style={styles.saveScheduleBtnText}>
              {scheduleEnabled || autoOffEnabled ? 'Save & Activate Automation' : 'Save Schedule Settings'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Appliance & Control Specs */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Appliance Details</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Appliance Type</Text>
            <Text style={styles.infoValue}>{isCurtain ? 'Motorized Curtain' : isFan ? 'Ceiling Fan' : 'Room Lighting'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Control Line</Text>
            <Text style={styles.infoValue}>{getCircuitChannel()}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Automation Hub</Text>
            <Text style={styles.infoValue}>Classroom Controller</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Network Link</Text>
            <Text style={[styles.infoValue, { color: esp32Connected ? colors.success : colors.warning }]}>
              {esp32Connected ? 'Online (Synced)' : 'Offline / Standby'}
            </Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>Last Updated</Text>
            <Text style={styles.infoValue}>{new Date(device.lastUpdated).toLocaleTimeString()}</Text>
          </View>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* iOS Modal Spinner Time Picker */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={activePicker !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setActivePicker(null)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setActivePicker(null)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.iosPickerContainer}>
              <View style={styles.iosPickerHeader}>
                <TouchableOpacity onPress={() => setActivePicker(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.iosPickerCancel}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.iosPickerTitle}>
                  {activePicker === 'on' ? 'Set Power ON Time' : 'Set Power OFF Time'}
                </Text>
                <TouchableOpacity 
                  onPress={() => {
                    if (activePicker) {
                      const formatted = dateToTimeString(tempPickerDate);
                      handleTimeConfirmed(activePicker, formatted);
                    }
                    setActivePicker(null);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.iosPickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempPickerDate}
                mode="time"
                is24Hour={false}
                display="spinner"
                textColor={colors.text}
                onValueChange={(_event: DateTimePickerChangeEvent, date?: Date) => {
                  if (date) setTempPickerDate(date);
                }}
                onDismiss={() => {
                  setActivePicker(null);
                }}
              />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Web & Universal Fallback Interactive Time Picker Modal */}
      {Platform.OS !== 'ios' && Platform.OS !== 'android' && (
        <Modal
          visible={activePicker !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setActivePicker(null)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setActivePicker(null)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.webPickerContainer}>
              <View style={styles.iosPickerHeader}>
                <Text style={styles.iosPickerTitle}>
                  {activePicker === 'on' ? 'Set Power ON Time' : 'Set Power OFF Time'}
                </Text>
                <TouchableOpacity onPress={() => setActivePicker(null)}>
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.webPickerBody}>
                <Text style={styles.webPickerSubLabel}>Select Hour</Text>
                <View style={styles.webPickerGrid}>
                  {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => {
                    const currentHours = tempPickerDate.getHours();
                    const currentH12 = currentHours % 12 === 0 ? 12 : currentHours % 12;
                    const isSelected = currentH12 === h;
                    return (
                      <TouchableOpacity
                        key={h}
                        style={[styles.webPickerGridBtn, isSelected && styles.webPickerGridBtnActive]}
                        onPress={() => {
                          const isPM = tempPickerDate.getHours() >= 12;
                          const newH = (h % 12) + (isPM ? 12 : 0);
                          const d = new Date(tempPickerDate);
                          d.setHours(newH);
                          setTempPickerDate(d);
                        }}
                      >
                        <Text style={[styles.webPickerGridText, isSelected && styles.webPickerGridTextActive]}>
                          {h}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.webPickerSubLabel}>Select Minute</Text>
                <View style={styles.webPickerGrid}>
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => {
                    const isSelected = tempPickerDate.getMinutes() === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[styles.webPickerGridBtn, isSelected && styles.webPickerGridBtnActive]}
                        onPress={() => {
                          const d = new Date(tempPickerDate);
                          d.setMinutes(m);
                          setTempPickerDate(d);
                        }}
                      >
                        <Text style={[styles.webPickerGridText, isSelected && styles.webPickerGridTextActive]}>
                          {String(m).padStart(2, '0')}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.webPickerAmPmRow}>
                  <TouchableOpacity
                    style={[
                      styles.webPickerAmPmBtn,
                      tempPickerDate.getHours() < 12 && styles.webPickerAmPmBtnActive
                    ]}
                    onPress={() => {
                      if (tempPickerDate.getHours() >= 12) {
                        const d = new Date(tempPickerDate);
                        d.setHours(tempPickerDate.getHours() - 12);
                        setTempPickerDate(d);
                      }
                    }}
                  >
                    <Text style={[
                      styles.webPickerAmPmText,
                      tempPickerDate.getHours() < 12 && styles.webPickerAmPmTextActive
                    ]}>AM</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.webPickerAmPmBtn,
                      tempPickerDate.getHours() >= 12 && styles.webPickerAmPmBtnActive
                    ]}
                    onPress={() => {
                      if (tempPickerDate.getHours() < 12) {
                        const d = new Date(tempPickerDate);
                        d.setHours(tempPickerDate.getHours() + 12);
                        setTempPickerDate(d);
                      }
                    }}
                  >
                    <Text style={[
                      styles.webPickerAmPmText,
                      tempPickerDate.getHours() >= 12 && styles.webPickerAmPmTextActive
                    ]}>PM</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.saveScheduleBtn}
                  onPress={() => {
                    if (activePicker) {
                      const formatted = dateToTimeString(tempPickerDate);
                      handleTimeConfirmed(activePicker, formatted);
                    }
                    setActivePicker(null);
                  }}
                >
                  <Text style={styles.saveScheduleBtnText}>Confirm {formatTime12h(dateToTimeString(tempPickerDate))}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      <FloatingBottomNav activeTab="classrooms" />
    </View>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: Layout.spacing.md,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
      paddingTop: 100,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    backBtn: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: Layout.radius.md,
      backgroundColor: colors.primary,
    },
    backBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    powerCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 16,
    },
    powerCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    deviceIconLarge: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 14,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    deviceIconLargeActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      borderColor: colors.primary,
    },
    powerInfo: {
      flex: 1,
    },
    deviceName: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 4,
    },
    deviceLocation: {
      color: colors.textMuted,
      fontSize: 13,
    },
    statusBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 6,
      gap: 6,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: Layout.radius.md,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 8,
    },
    actionButtonActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    actionButtonText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    actionButtonTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    statsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 16,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: 11,
    },
    statValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    infoCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    infoTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 14,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    infoLabel: {
      color: colors.textMuted,
      fontSize: 13,
    },
    infoValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    loadCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.25)' : 'rgba(217, 119, 6, 0.25)',
      marginBottom: 20,
    },
    loadHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
      gap: 10,
    },
    loadTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    loadTextContainer: {
      flex: 1,
      paddingRight: 6,
    },
    loadIconBox: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    loadCardTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    loadCardSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
      lineHeight: 15,
    },
    editLoadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.1)',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Layout.radius.sm,
      gap: 4,
      flexShrink: 0,
    },
    editLoadBtnText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    loadValueRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 12,
    },
    loadValueLabel: {
      color: colors.textMuted,
      fontSize: 13,
    },
    loadValueText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    loadEditContainer: {
      marginTop: 14,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    loadEditLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 8,
    },
    presetsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    presetChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    presetChipActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.2)' : 'rgba(217, 119, 6, 0.15)',
      borderColor: colors.primary,
    },
    presetChipText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    presetChipTextActive: {
      color: colors.primary,
    },
    customInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    stepBtn: {
      width: 38,
      height: 38,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : colors.cardSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    loadInput: {
      flex: 1,
      height: 38,
      backgroundColor: colors.inputBackground,
      borderRadius: Layout.radius.sm,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      color: colors.text,
      textAlign: 'center',
      fontSize: 15,
      fontWeight: '700',
    },
    saveWattsBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      height: 38,
      borderRadius: Layout.radius.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    saveWattsBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },

    // WS2812B 15-LED Physical Strip Visualizer
    rgbVisualizerCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      padding: 16,
      borderWidth: 1.5,
      marginBottom: 16,
    },
    rgbVisualizerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14,
    },
    rgbBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
    },
    rgbBadgeText: {
      fontSize: 12,
      fontWeight: '700',
    },
    rgbLiveText: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    ledStripBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: isDark ? '#141414' : '#E5E7EB',
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: isDark ? '#262626' : '#D1D5DB',
    },
    ledPixelWrapper: {
      alignItems: 'center',
      gap: 4,
    },
    ledPixelDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
    },
    ledPixelIndex: {
      fontSize: 9,
      fontWeight: '600',
      color: colors.textMuted,
    },

    // WS2812B Color Palette Card
    rgbColorCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 16,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    cardTitleBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    cardSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    iconPill: {
      width: 36,
      height: 36,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    colorPreviewBubble: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: isDark ? '#FFFFFF' : '#000000',
    },
    colorPresetsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 16,
    },
    colorPresetItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1.5,
      borderColor: colors.surfaceBorder,
    },
    colorSwatchCircle: {
      width: 20,
      height: 20,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.15)',
    },
    colorPresetLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    hexInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    hexInputSwatch: {
      width: 38,
      height: 38,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    hexInput: {
      flex: 1,
      height: 38,
      backgroundColor: colors.inputBackground,
      borderRadius: Layout.radius.sm,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      color: colors.text,
      paddingHorizontal: 12,
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 1,
    },
    applyHexBtn: {
      paddingHorizontal: 16,
      height: 38,
      borderRadius: Layout.radius.sm,
      justifyContent: 'center',
      alignItems: 'center',
    },
    applyHexBtnText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },

    // WS2812B Settings & Modes Card
    rgbSettingsCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 16,
    },
    brightnessControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    brightnessStepBtn: {
      width: 40,
      height: 40,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : colors.cardSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    brightnessChipsGroup: {
      flex: 1,
      flexDirection: 'row',
      gap: 6,
    },
    brightnessChip: {
      flex: 1,
      height: 40,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    brightnessChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    rgbModesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    rgbModeCard: {
      flex: 1,
      minWidth: '45%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : colors.cardSecondary,
      borderWidth: 1.5,
      borderColor: colors.surfaceBorder,
    },
    rgbModeLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },

    // Power Schedule & Automation Card
    scheduleCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.25)' : 'rgba(217, 119, 6, 0.25)',
      marginBottom: 20,
    },
    scheduleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    scheduleTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    scheduleIconBox: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    scheduleTextContainer: {
      flex: 1,
      paddingRight: 6,
    },
    scheduleCardTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    scheduleCardSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
      lineHeight: 15,
    },
    scheduleSection: {
      marginTop: 14,
    },
    scheduleSectionLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 8,
    },
    schedulePresetsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    schedulePresetChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    schedulePresetChipActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.2)' : 'rgba(217, 119, 6, 0.15)',
      borderColor: colors.primary,
    },
    schedulePresetChipText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    schedulePresetChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    timeSetterRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 14,
    },
    timePickerCard: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : colors.cardSecondary,
      borderRadius: Layout.radius.md,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    timeSetterBoxHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    timeSetterBoxTitle: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: colors.textMuted,
    },
    timeDisplayBig: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    timeDisplaySub: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
      marginBottom: 8,
    },
    pickTimeActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.08)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.3)' : 'rgba(217, 119, 6, 0.25)',
    },
    pickTimeActionText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    iosPickerContainer: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      paddingBottom: 20,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      width: '100%',
      maxWidth: 360,
      overflow: 'hidden',
    },
    iosPickerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    iosPickerTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    iosPickerCancel: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    iosPickerDone: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '700',
    },
    webPickerContainer: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      width: '100%',
      maxWidth: 360,
    },
    webPickerBody: {
      paddingTop: 8,
    },
    webPickerSubLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: 6,
      marginTop: 8,
    },
    webPickerGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    webPickerGridBtn: {
      width: 44,
      height: 34,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    webPickerGridBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    webPickerGridText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    webPickerGridTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    webPickerAmPmRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
      marginBottom: 6,
    },
    webPickerAmPmBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    webPickerAmPmBtnActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.2)' : 'rgba(217, 119, 6, 0.15)',
      borderColor: colors.primary,
    },
    webPickerAmPmText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    webPickerAmPmTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    daysHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    daysPresetRow: {
      flexDirection: 'row',
      gap: 6,
    },
    dayFilterBtn: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
    },
    dayFilterBtnText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    daysChipsRow: {
      flexDirection: 'row',
      gap: 6,
      justifyContent: 'space-between',
    },
    dayChip: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    dayChipActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.2)' : 'rgba(217, 119, 6, 0.15)',
      borderColor: colors.primary,
    },
    dayChipText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    dayChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    autoOffDivider: {
      height: 1,
      backgroundColor: colors.surfaceBorder,
      marginVertical: 14,
    },
    autoOffHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    autoOffTitleCol: {
      flex: 1,
      paddingRight: 8,
    },
    autoOffTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    autoOffTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    autoOffSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    autoOffBody: {
      marginTop: 12,
    },
    autoOffChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    autoOffChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    autoOffChipActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.2)' : 'rgba(217, 119, 6, 0.15)',
      borderColor: colors.primary,
    },
    autoOffChipText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    autoOffChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    autoOffLiveStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 10,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
    },
    autoOffLiveText: {
      fontSize: 12,
      fontWeight: '600',
    },
    saveScheduleBtn: {
      marginTop: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: Layout.radius.md,
      gap: 8,
    },
    saveScheduleBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
    },
  });
}
