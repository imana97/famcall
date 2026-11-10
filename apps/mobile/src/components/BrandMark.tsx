// Generated from brand/famcall-glyph.svg by scripts/render-icons.sh.
import Svg, { G, Path, Rect } from "react-native-svg";

type BrandMarkProps = {
  size?: number;
  tile?: boolean;
};

/** Decorative brand mark; pair it with the accessible FamCall name. */
export function BrandMark({ size = 48, tile = true }: BrandMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessible={false}>
      {tile ? <Rect width="1024" height="1024" rx="224" fill="#183D34" /> : null}
      <G fill="none" stroke="#C5DF9E" strokeWidth="36" strokeLinecap="round">
        <Path d="M497 247C637 239 754 349 754 497" />
        <Path d="M267 520C268 652 376 755 527 747" />
      </G>
      <Path fill="#F5F4E9" d="M380 257C405 256 419 280 436 307L459 345C477 377 470 392 444 412L424 427C405 441 409 455 420 476C445 519 497 569 533 583C554 591 562 586 574 571L597 543C620 516 638 520 661 533L716 569C746 588 753 610 739 641C724 674 696 704 665 718C626 735 597 725 563 711C464 671 377 599 322 518C287 467 272 427 272 372C272 338 291 314 313 293C339 268 362 257 380 257Z" />
    </Svg>
  );
}
