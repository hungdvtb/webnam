<?php

namespace App\Support;

class BatTrangCategoryBranding
{
    public function __construct(private readonly string $assetDirectory)
    {
        if (!is_dir($this->assetDirectory)) {
            mkdir($this->assetDirectory, 0777, true);
        }
    }

    /**
     * @param  array<string, mixed>  $definition
     * @return array{banner_path: string, logo_path: string}
     */
    public function generate(array $definition): array
    {
        $bannerName = $definition['slug'] . '-banner.svg';
        $logoName = $definition['slug'] . '-logo.svg';

        file_put_contents($this->assetDirectory . DIRECTORY_SEPARATOR . $bannerName, $this->buildBannerSvg($definition));
        file_put_contents($this->assetDirectory . DIRECTORY_SEPARATOR . $logoName, $this->buildLogoSvg($definition));

        return [
            'banner_path' => '/category_assets/bat-trang-categories/' . $bannerName,
            'logo_path' => '/category_assets/bat-trang-categories/' . $logoName,
        ];
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private function buildBannerSvg(array $definition): string
    {
        $palette = $definition['palette'];
        $theme = (string) $definition['theme'];
        $slug = (string) $definition['slug'];
        $guideWidth = (int) round(620 * (float) $definition['guide_ratio']);
        $setScale = (float) $definition['scale'];
        $crackle = $theme === 'men_ran' ? $this->crackleLines($slug, 700, 70, 770, 520, $palette['crackle'], 0.24, 32) : '';
        $filigree = $theme === 've_vang' ? $this->filigreeGroup(1045, 188, 430, 250, $palette['gold'], 0.5) : '';
        $measure = in_array($theme, ['size_selector', 'size'], true)
            ? $this->measureGuide(1080, 175, $guideWidth, $palette, 1.0)
            : '';
        $miniSets = $theme === 'size_selector' ? $this->miniSetRow($palette) : '';

        return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 760" fill="none">
  <defs>
    <linearGradient id="bg-{$slug}" x1="0" y1="0" x2="1600" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{$this->hex($palette['bg_left'])}" />
      <stop offset="100%" stop-color="{$this->hex($palette['bg_right'])}" />
    </linearGradient>
    <linearGradient id="shade-{$slug}" x1="0" y1="0" x2="760" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="{$this->rgba([6, 12, 22], 0.78)}" />
      <stop offset="100%" stop-color="{$this->rgba([6, 12, 22], 0.08)}" />
    </linearGradient>
    <radialGradient id="mist-{$slug}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1080 320) rotate(90) scale(360 360)">
      <stop offset="0%" stop-color="{$this->rgba($palette['mist'], 0.88)}" />
      <stop offset="100%" stop-color="{$this->rgba($palette['mist'], 0)}" />
    </radialGradient>
    <radialGradient id="gold-{$slug}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(1290 190) rotate(90) scale(170 170)">
      <stop offset="0%" stop-color="{$this->rgba($palette['gold'], 0.8)}" />
      <stop offset="100%" stop-color="{$this->rgba($palette['gold'], 0)}" />
    </radialGradient>
    <filter id="blur-{$slug}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="36" />
    </filter>
  </defs>

  <rect width="1600" height="760" fill="url(#bg-{$slug})"/>
  <rect width="760" height="760" fill="url(#shade-{$slug})"/>
  <ellipse cx="1080" cy="320" rx="360" ry="360" fill="url(#mist-{$slug})" filter="url(#blur-{$slug})"/>
  <ellipse cx="1290" cy="190" rx="170" ry="170" fill="url(#gold-{$slug})" filter="url(#blur-{$slug})"/>

  <g opacity="0.42" stroke="{$this->rgba($palette['accent_soft'], 0.56)}" stroke-width="3">
    <path d="M746 504C792 292 904 206 1010 206c106 0 210 86 254 298" />
    <path d="M784 504C822 324 914 252 1010 252c96 0 188 72 226 252" />
    <path d="M824 504C856 354 932 294 1010 294c78 0 154 60 186 210" />
    <path d="M860 504C888 382 948 334 1010 334c62 0 122 48 150 170" />
  </g>

  <g opacity="0.5" stroke="{$this->rgba($palette['accent_soft'], 0.42)}" stroke-width="2">
    <path d="M150 132C258 118 398 118 540 132" />
    <path d="M188 176C282 164 394 164 486 176" />
    <path d="M206 218C282 210 370 210 442 218" />
    <path d="M192 198C268 172 336 172 430 198" stroke="{$this->rgba($palette['gold'], 0.35)}"/>
  </g>

  {$crackle}
  {$filigree}
  {$measure}
  {$miniSets}

  {$this->altarSet(1115, 610, $setScale, $palette, $theme)}
</svg>
SVG;
    }

    /**
     * @param  array<string, mixed>  $definition
     */
    private function buildLogoSvg(array $definition): string
    {
        $palette = $definition['palette'];
        $theme = (string) $definition['theme'];
        $slug = (string) $definition['slug'];
        $guideWidth = (int) round(220 * (float) $definition['guide_ratio']);
        $scale = max(((float) $definition['scale']) * 0.43, 0.32);
        $crackle = $theme === 'men_ran' ? $this->crackleLines($slug . '-logo', 170, 126, 300, 260, $palette['crackle'], 0.22, 18) : '';
        $filigree = $theme === 've_vang' ? $this->filigreeGroup(320, 196, 220, 120, $palette['gold'], 0.44) : '';
        $measure = in_array($theme, ['size_selector', 'size'], true)
            ? $this->measureGuide(320, 470, $guideWidth, $palette, 0.62)
            : '';

        return <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="none">
  <defs>
    <filter id="shadow-{$slug}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="26" />
    </filter>
    <radialGradient id="disc-{$slug}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(320 308) rotate(90) scale(190 190)">
      <stop offset="0%" stop-color="{$this->hex($palette['ceramic'])}" />
      <stop offset="100%" stop-color="{$this->rgba($palette['ceramic'], 0.92)}" />
    </radialGradient>
  </defs>

  <ellipse cx="320" cy="350" rx="180" ry="180" fill="{$this->rgba([0, 0, 0], 0.34)}" filter="url(#shadow-{$slug})"/>
  <circle cx="320" cy="320" r="206" fill="{$this->rgba($palette['gold'], 0.18)}"/>
  <circle cx="320" cy="308" r="192" fill="url(#disc-{$slug})"/>
  <circle cx="320" cy="308" r="180" stroke="{$this->rgba($palette['outline'], 0.55)}" stroke-width="4"/>
  <circle cx="320" cy="308" r="162" stroke="{$this->rgba($palette['gold'], 0.62)}" stroke-width="3"/>

  {$crackle}
  {$filigree}
  {$measure}
  {$this->altarSet(320, 420, $scale, $palette, $theme, true)}
</svg>
SVG;
    }

    private function altarSet(int $cx, int $baseY, float $scale, array $palette, string $theme, bool $logo = false): string
    {
        $shadow = $this->rgba($palette['shadow'], $logo ? 0.38 : 0.28);
        $stage = $this->rgba($palette['outline'], $logo ? 0.3 : 0.24);
        $stageTop = $this->rgba($palette['gold'], $logo ? 0.38 : 0.3);
        $ceramic = $this->hex($palette['ceramic']);
        $outline = $this->rgba($palette['outline'], 0.9);
        $accent = $this->rgba($palette['accent'], 0.78);
        $gold = $this->rgba($palette['gold'], 0.82);

        $goldLines = ($theme === 've_vang' || str_starts_with($theme, 'size'))
            ? <<<SVG
      <line x1="-34" y1="-126" x2="34" y2="-126" stroke="{$gold}" stroke-width="3.2" stroke-linecap="round"/>
      <line x1="-250" y1="-124" x2="-202" y2="-124" stroke="{$gold}" stroke-width="3" stroke-linecap="round"/>
      <line x1="202" y1="-124" x2="250" y2="-124" stroke="{$gold}" stroke-width="3" stroke-linecap="round"/>
      <line x1="-146" y1="-106" x2="-118" y2="-106" stroke="{$gold}" stroke-width="3" stroke-linecap="round"/>
      <line x1="118" y1="-106" x2="146" y2="-106" stroke="{$gold}" stroke-width="3" stroke-linecap="round"/>
      <line x1="-72" y1="-20" x2="-56" y2="-20" stroke="{$gold}" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="-8" y1="-20" x2="8" y2="-20" stroke="{$gold}" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="56" y1="-20" x2="72" y2="-20" stroke="{$gold}" stroke-width="2.4" stroke-linecap="round"/>
SVG
            : '';

        return <<<SVG
<g transform="translate({$cx} {$baseY}) scale({$scale})">
  <ellipse cx="0" cy="18" rx="280" ry="38" fill="{$shadow}"/>
  <rect x="-300" y="-18" width="600" height="32" rx="16" fill="{$stage}"/>
  <line x1="-278" y1="-12" x2="278" y2="-12" stroke="{$stageTop}" stroke-width="4" stroke-linecap="round"/>

  <path d="M-255 0C-276-58-262-180-230-238C-214-266-208-286-206-314H-176C-174-286-168-266-152-238C-120-180-106-58-126 0Z" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="-191" cy="-314" rx="18" ry="6" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <line x1="-224" y1="-118" x2="-158" y2="-118" stroke="{$accent}" stroke-width="4" stroke-linecap="round"/>
  <line x1="-234" y1="-84" x2="-148" y2="-84" stroke="{$accent}" stroke-width="4" stroke-linecap="round"/>

  <path d="M255 0C276-58 262-180 230-238C214-266 208-286 206-314H176C174-286 168-266 152-238C120-180 106-58 126 0Z" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="191" cy="-314" rx="18" ry="6" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <line x1="158" y1="-118" x2="224" y2="-118" stroke="{$accent}" stroke-width="4" stroke-linecap="round"/>
  <line x1="148" y1="-84" x2="234" y2="-84" stroke="{$accent}" stroke-width="4" stroke-linecap="round"/>

  <rect x="-142" y="-182" width="28" height="126" rx="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="-128" cy="-56" rx="18" ry="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <rect x="-136" y="-56" width="16" height="34" rx="7" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="-128" cy="12" rx="16" ry="7" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <line x1="-142" y1="-116" x2="-114" y2="-116" stroke="{$accent}" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M-128-214L-138-182L-128-192L-118-182Z" fill="{$gold}"/>

  <rect x="114" y="-182" width="28" height="126" rx="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="128" cy="-56" rx="18" ry="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <rect x="120" y="-56" width="16" height="34" rx="7" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="128" cy="12" rx="16" ry="7" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <line x1="114" y1="-116" x2="142" y2="-116" stroke="{$accent}" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M128-214L118-182L128-192L138-182Z" fill="{$gold}"/>

  <ellipse cx="0" cy="-92" rx="92" ry="58" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <rect x="-18" y="-62" width="36" height="48" rx="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="0" cy="6" rx="34" ry="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <ellipse cx="0" cy="-136" rx="48" ry="10" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <path d="M-34-134Q0-176 34-134L22-120H-22Z" fill="{$ceramic}" stroke="{$outline}" stroke-width="3"/>
  <circle cx="0" cy="-180" r="7" fill="{$gold}"/>
  <line x1="-54" y1="-102" x2="54" y2="-102" stroke="{$accent}" stroke-width="4" stroke-linecap="round"/>
  <line x1="-58" y1="-74" x2="58" y2="-74" stroke="{$accent}" stroke-width="4" stroke-linecap="round"/>

  <ellipse cx="-64" cy="-20" rx="18" ry="13" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <rect x="-71" y="-20" width="14" height="22" rx="6" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <ellipse cx="-64" cy="6" rx="10" ry="4" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>

  <ellipse cx="0" cy="-20" rx="18" ry="13" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <rect x="-7" y="-20" width="14" height="22" rx="6" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <ellipse cx="0" cy="6" rx="10" ry="4" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>

  <ellipse cx="64" cy="-20" rx="18" ry="13" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <rect x="57" y="-20" width="14" height="22" rx="6" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <ellipse cx="64" cy="6" rx="10" ry="4" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>

  <ellipse cx="0" cy="6" rx="54" ry="16" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <rect x="-8" y="6" width="16" height="18" rx="7" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>
  <ellipse cx="0" cy="28" rx="18" ry="6" fill="{$ceramic}" stroke="{$outline}" stroke-width="2.8"/>

{$goldLines}
</g>
SVG;
    }

    private function measureGuide(int $cx, int $y, int $width, array $palette, float $scale): string
    {
        $left = $cx - (int) round($width / 2);
        $right = $cx + (int) round($width / 2);
        $topY = $y - 12;
        $bottomY = $y + 12;
        $arrowLeftX = $left + 14;
        $arrowRightX = $right - 14;
        $arrowTopY = $y - 7;
        $arrowBottomY = $y + 7;
        $goldStroke = $this->rgba($palette['gold'], 0.52);
        $accentStroke = $this->rgba($palette['accent'], 0.42);
        $arrowFill = $this->rgba($palette['gold'], 0.72);
        $ticks = [];
        for ($tick = 1; $tick <= 4; $tick++) {
            $tickX = $left + (int) round(($width / 5) * $tick);
            $ticks[] = '<line x1="' . $tickX . '" y1="' . ($y - (int) round(8 * $scale)) . '" x2="' . $tickX . '" y2="' . ($y + (int) round(8 * $scale)) . '" stroke="' . $accentStroke . '" stroke-width="2" stroke-linecap="round"/>';
        }

        return <<<SVG
<g>
  <line x1="{$left}" y1="{$y}" x2="{$right}" y2="{$y}" stroke="{$goldStroke}" stroke-width="2.6" stroke-linecap="round"/>
  <line x1="{$left}" y1="{$topY}" x2="{$left}" y2="{$bottomY}" stroke="{$accentStroke}" stroke-width="2" stroke-linecap="round"/>
  <line x1="{$right}" y1="{$topY}" x2="{$right}" y2="{$bottomY}" stroke="{$accentStroke}" stroke-width="2" stroke-linecap="round"/>
  {$this->join($ticks)}
  <path d="M{$left} {$y} L{$arrowLeftX} {$arrowTopY} L{$arrowLeftX} {$arrowBottomY} Z" fill="{$arrowFill}"/>
  <path d="M{$right} {$y} L{$arrowRightX} {$arrowTopY} L{$arrowRightX} {$arrowBottomY} Z" fill="{$arrowFill}"/>
</g>
SVG;
    }

    private function miniSetRow(array $palette): string
    {
        $groups = [];
        for ($index = 0; $index < 5; $index++) {
            $ratio = 0.24 + ($index * 0.07);
            $groups[] = $this->measureGuide(940 + ($index * 115), 514, (int) round(110 * $ratio + 58), $palette, 0.45);
            $groups[] = $this->altarSet(940 + ($index * 115), 610, 0.22 + ($index * 0.02), $palette, 'size_selector');
        }

        return $this->join($groups);
    }

    private function filigreeGroup(int $cx, int $cy, int $width, int $height, array $color, float $opacity): string
    {
        $arcs = [];
        foreach ([0, 38, 76] as $offset) {
            $arcs[] = '<path d="M' . ($cx - (int) round(($width - $offset) / 2)) . ' ' . ($cy + (int) round($offset * 0.12))
                . ' Q' . $cx . ' ' . ($cy - (int) round(($height - ($offset * 0.7)) / 2))
                . ' ' . ($cx + (int) round(($width - $offset) / 2)) . ' ' . ($cy + (int) round($offset * 0.12))
                . '" stroke="' . $this->rgba($color, $opacity - ($offset * 0.0015)) . '" stroke-width="2" stroke-linecap="round"/>';
        }

        $dots = [];
        foreach ([-1, 1] as $direction) {
            for ($i = 0; $i < 8; $i++) {
                $dots[] = '<circle cx="' . ($cx + ($direction * (65 + ($i * 22)))) . '" cy="' . ($cy + 18 + (($i % 3) * 14)) . '" r="' . (10 - min($i, 5)) . '" fill="' . $this->rgba($color, 0.18 + ($i * 0.035)) . '"/>';
            }
        }

        return $this->join($arcs) . $this->join($dots);
    }

    private function crackleLines(string $seedKey, int $x, int $y, int $width, int $height, array $color, float $opacity, int $count): string
    {
        $seed = abs(crc32($seedKey));
        $lines = [];
        for ($i = 0; $i < $count; $i++) {
            $ratio = (($seed + ($i * 97)) % 1000) / 1000;
            $ratioB = (($seed + ($i * 181)) % 1000) / 1000;
            $ratioC = (($seed + ($i * 263)) % 1000) / 1000;
            $ratioD = (($seed + ($i * 347)) % 1000) / 1000;

            $sx = $x + (int) round($width * $ratio);
            $sy = $y + (int) round($height * $ratioB);
            $mx = $sx + (int) round((-28 + (56 * $ratioC)));
            $my = $sy + 18 + (int) round(42 * $ratioD);
            $ex = $mx + (int) round((-32 + (64 * $ratioB)));
            $ey = $my + 18 + (int) round(42 * $ratioC);

            $lines[] = '<path d="M' . $sx . ' ' . $sy . ' L' . $mx . ' ' . $my . ' L' . $ex . ' ' . $ey . '" stroke="' . $this->rgba($color, max($opacity - ($i * 0.003), 0.08)) . '" stroke-width="1.2" stroke-linecap="round"/>';
        }

        return $this->join($lines);
    }

    private function hex(array $rgb): string
    {
        return sprintf('#%02x%02x%02x', $rgb[0], $rgb[1], $rgb[2]);
    }

    private function rgba(array $rgb, float $opacity): string
    {
        return sprintf('rgba(%d,%d,%d,%.3f)', $rgb[0], $rgb[1], $rgb[2], max(min($opacity, 1), 0));
    }

    /**
     * @param  array<int, string>  $parts
     */
    private function join(array $parts): string
    {
        return implode("\n", array_filter($parts));
    }
}
