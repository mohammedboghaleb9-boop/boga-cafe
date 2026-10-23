import { useId } from 'react';

/*
 * Original line drawings for the origins section, drawn for BOGA (no outside artwork):
 * abstract terrain contours, a coffee branch, a few roasted beans and light ridge lines.
 * Decorative only: never a map, a farm or a country.
 */

/** Seven nested, irregular contour lines (generated once, kept as plain path data). */
const contours = [
  'M339 200C338 204 336 209 333 212C330 215 325 218 321 219C316 221 311 220 307 221C302 222 298 224 293 224C287 224 281 224 276 222C272 220 268 216 266 212C264 208 262 204 263 200C263 196 266 192 269 189C272 186 275 183 279 181C283 178 288 176 292 175C297 174 302 175 307 176C312 177 317 179 321 180C326 182 331 185 334 188C337 191 339 196 339 200Z',
  'M375 197C374 204 370 213 364 219C359 224 349 228 340 231C332 234 325 234 316 236C308 238 299 243 290 244C280 244 268 242 260 238C251 234 245 226 241 219C237 213 235 204 236 197C237 190 243 183 248 177C253 171 259 166 266 162C273 157 281 153 290 151C298 150 308 152 317 153C326 155 335 156 344 160C353 163 363 168 369 174C374 180 376 190 375 197Z',
  'M413 194C412 205 405 217 396 225C387 234 372 238 361 243C349 248 339 249 326 253C314 257 300 266 286 267C271 267 252 263 240 257C228 250 219 238 214 228C208 217 206 204 208 194C210 184 219 174 226 165C233 156 241 147 251 141C261 134 274 127 287 125C300 123 314 127 328 129C342 130 357 132 370 137C383 142 399 149 407 159C414 168 415 183 413 194Z',
  'M453 191C450 206 440 222 428 232C416 243 396 248 381 255C366 262 354 267 338 274C321 280 300 294 280 294C260 295 235 287 219 278C203 268 192 251 185 236C178 222 176 205 179 191C182 177 193 164 203 152C212 140 221 128 234 119C247 109 266 100 283 98C301 95 320 99 340 101C359 103 381 104 399 110C417 117 439 129 448 143C457 156 456 176 453 191Z',
  'M493 188C488 207 475 226 459 239C444 253 421 259 403 269C385 279 372 289 350 299C328 308 299 326 273 326C248 326 216 313 196 300C176 286 163 264 155 246C147 227 145 206 149 188C153 170 167 154 178 139C189 123 198 106 215 94C232 82 256 72 279 68C302 64 327 69 352 71C377 73 408 72 431 81C454 90 480 108 491 126C501 143 498 169 493 188Z',
  'M533 185C525 208 509 230 491 246C473 262 447 270 426 284C405 297 391 316 364 329C337 342 298 363 265 362C233 361 196 340 172 322C148 305 133 278 124 255C115 232 114 207 119 185C123 163 139 144 151 125C164 105 173 82 193 67C214 52 245 41 274 36C303 31 333 35 366 37C398 40 438 37 466 49C495 61 524 86 535 108C546 131 540 162 533 185Z',
  'M571 182C562 209 543 233 523 253C503 273 476 283 452 301C429 320 413 348 380 365C348 382 295 405 256 401C218 398 175 368 148 345C121 323 104 291 94 264C84 237 84 208 88 182C93 156 108 134 122 110C135 86 144 56 169 38C193 20 233 7 268 1C303 -5 341 -2 380 -0C419 2 471 -1 504 14C538 30 568 63 579 91C591 119 580 155 571 182Z',
];

const leaf = 'M0 0C14-16 46-18 64 0C46 18 14 16 0 0Z';
/** x, y, angle, scale of each leaf along the stem. */
const leaves: [number, number, number, number][] = [
  [228, 26, -125, 0.8],
  [200, 46, 40, 1],
  [165, 66, -150, 1],
  [130, 90, 70, 0.95],
  [95, 114, -165, 0.9],
  [60, 142, 95, 0.8],
];
const cherries: [number, number][] = [
  [182, 60],
  [190, 66],
  [181, 70],
  [110, 104],
  [118, 110],
  [108, 113],
  [74, 132],
  [82, 137],
];
/** x, y, height, angle of each roasted bean at the band's edge. */
const beans: [number, number, number, number][] = [
  [52, 40, 24, -20],
  [88, 118, 18, 35],
  [40, 210, 30, 10],
  [92, 300, 20, -40],
  [50, 380, 26, 60],
];

/** The band's background: contours behind the title and the cards, a branch by the photo, beans at the edge. */
export function OriginsDecor() {
  const leafId = `${useId()}leaf`;
  return (
    <div className="origins-decor" aria-hidden="true">
      <svg className="origins-contours" viewBox="0 0 600 400" focusable="false">
        {contours.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
      <svg className="origins-branch" viewBox="0 0 260 200" focusable="false">
        <defs>
          <g id={leafId}>
            <path d={leaf} />
            <path d="M2 0H60" />
          </g>
        </defs>
        <path d="M250 10C210 40 170 70 120 95S40 150 10 190" />
        {leaves.map(([x, y, a, s]) => (
          <use key={`${x}-${y}`} href={`#${leafId}`} transform={`translate(${x} ${y}) rotate(${a}) scale(${s})`} />
        ))}
        {cherries.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="5" />
        ))}
      </svg>
      <svg className="origins-scatter" viewBox="0 0 120 420" focusable="false">
        {beans.map(([x, y, h, a]) => (
          <g key={y} transform={`translate(${x} ${y}) rotate(${a}) scale(${h / 22})`}>
            <ellipse rx="6.2" ry="9.4" />
            <path d="M.6-8.6C-2-5.8-2-3.2 0 0s2 5.8-.6 8.6" />
          </g>
        ))}
      </svg>
    </div>
  );
}

const ridges = [
  // mountain ridges
  ['M0 74L26 58L44 64L74 36L98 50L124 30L156 48L178 40L200 46', 'M0 80L34 68L60 72L92 54L120 64L150 52L200 60'],
  // rolling hills
  ['M0 70C30 52 54 52 80 62S136 40 166 48 200 56 200 56', 'M0 80C36 66 64 68 96 74S150 60 200 66'],
  // terraced rows
  ['M0 50C50 44 100 56 200 46', 'M0 62C50 56 100 68 200 58', 'M0 74C50 68 100 80 200 70'],
];

/** Light terrain lines in a card's corner: three drawings in turn, never tied to the country. */
export function CardTerrain({ index }: { index: number }) {
  return (
    <svg className="origin-terrain" viewBox="0 0 200 84" preserveAspectRatio="xMaxYMax meet" aria-hidden="true" focusable="false">
      {ridges[index % ridges.length].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
