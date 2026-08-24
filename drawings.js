/* ---------------------------------------------------------------------------
 * drawings.js  --  the coloring book pages.
 *
 * Each drawing is plain SVG markup. Three CSS classes do all the work:
 *
 *   class="region"  a closed shape a child can click to fill with color.
 *   class="ink"     solid black detail (pupils, etc). Not clickable.
 *   class="line"    a stroke-only detail (whiskers, smiles). Not clickable.
 *
 * Shapes are painted in the order they appear, so put things that should sit
 * BEHIND (tails, fins, wings) before the body, and details after it.
 *
 * To add a new page: copy one of these blocks, change the id/name, draw your
 * shapes on the 0 0 400 400 grid, and it shows up in the gallery automatically.
 * ------------------------------------------------------------------------- */

const DRAWINGS = [

  /* ----------------------------------------------------------------- FISH */
  {
    id: 'fish',
    name: 'Fish',
    viewBox: '0 0 400 400',
    svg: `
      <!-- tail and fins first so they tuck behind the body -->
      <path class="region" d="M 128 178 C 96 178 62 152 45 138 C 48 165 58 190 62 200
                              C 58 210 48 235 45 262 C 62 248 96 222 128 222 Z"/>
      <path class="region" d="M 212 118 C 234 68 290 58 314 88 C 300 108 300 128 302 146 Z"/>
      <path class="region" d="M 214 284 C 236 330 292 340 314 312 C 300 292 300 274 302 256 Z"/>

      <!-- body -->
      <path class="region" d="M 110 200 C 110 145 165 108 225 108 C 290 108 335 150 348 200
                              C 335 250 290 292 225 292 C 165 292 110 255 110 200 Z"/>

      <!-- scales panel: a second region inside the body, fun to color -->
      <path class="region" d="M 140 200 C 140 168 168 148 198 148 C 224 148 238 172 240 200
                              C 238 228 224 252 198 252 C 168 252 140 232 140 200 Z"/>

      <!-- details -->
      <path class="line" d="M 262 122 C 240 165 240 235 262 282"/>
      <circle class="region" cx="300" cy="170" r="19"/>
      <circle class="ink" cx="304" cy="172" r="8"/>
      <path class="line" d="M 326 206 C 336 214 342 216 348 213"/>

      <!-- bubbles -->
      <circle class="region" cx="368" cy="92" r="15"/>
      <circle class="region" cx="388" cy="54" r="9"/>
      <circle class="region" cx="358" cy="42" r="6"/>
    `
  },

  /* ------------------------------------------------------------------ CAT */
  {
    id: 'cat',
    name: 'Cat',
    viewBox: '0 0 400 400',
    svg: `
      <!-- tail behind everything -->
      <path class="region" d="M 268 352 C 350 352 370 268 332 214 C 322 200 298 204 302 220
                              C 330 266 320 314 264 316 Z"/>

      <!-- paws, behind the body so only the toes show -->
      <path class="region" d="M 126 370 C 126 338 178 338 178 370 C 178 378 126 378 126 370 Z"/>
      <path class="region" d="M 222 370 C 222 338 274 338 274 370 C 274 378 222 378 222 370 Z"/>

      <!-- body -->
      <path class="region" d="M 132 210 C 108 260 106 330 124 356 L 276 356
                              C 294 330 292 260 268 210 Z"/>
      <path class="region" d="M 200 248 C 172 248 158 298 164 340 L 236 340
                              C 242 298 228 248 200 248 Z"/>

      <!-- ears behind the head -->
      <path class="region" d="M 128 104 L 156 24 L 198 84 Z"/>
      <path class="region" d="M 272 104 L 244 24 L 202 84 Z"/>

      <!-- head -->
      <path class="region" d="M 200 62 C 152 62 118 102 118 148 C 118 200 152 236 200 236
                              C 248 236 282 200 282 148 C 282 102 248 62 200 62 Z"/>

      <!-- inner ears -->
      <path class="region" d="M 148 80 L 158 42 L 174 72 Z"/>
      <path class="region" d="M 252 80 L 242 42 L 226 72 Z"/>

      <!-- face -->
      <ellipse class="region" cx="170" cy="140" rx="17" ry="21"/>
      <ellipse class="region" cx="230" cy="140" rx="17" ry="21"/>
      <ellipse class="ink" cx="170" cy="141" rx="7" ry="13"/>
      <ellipse class="ink" cx="230" cy="141" rx="7" ry="13"/>
      <path class="region" d="M 200 172 L 213 160 L 187 160 Z"/>
      <path class="line" d="M 200 172 L 200 184"/>
      <path class="line" d="M 200 184 C 190 196 176 194 172 183"/>
      <path class="line" d="M 200 184 C 210 196 224 194 228 183"/>
      <path class="line" d="M 166 172 L 116 161"/>
      <path class="line" d="M 166 181 L 114 186"/>
      <path class="line" d="M 234 172 L 284 161"/>
      <path class="line" d="M 234 181 L 286 186"/>
    `
  },

  /* ------------------------------------------------------------ BUTTERFLY */
  {
    id: 'butterfly',
    name: 'Butterfly',
    viewBox: '0 0 400 400',
    svg: `
      <!-- wings -->
      <path class="region" d="M 190 150 C 150 88 70 68 45 110 C 20 152 62 202 120 212
                              C 156 218 181 191 190 150 Z"/>
      <path class="region" d="M 210 150 C 250 88 330 68 355 110 C 380 152 338 202 280 212
                              C 244 218 219 191 210 150 Z"/>
      <path class="region" d="M 190 216 C 160 232 90 242 75 286 C 60 326 110 350 150 330
                              C 180 315 193 266 190 216 Z"/>
      <path class="region" d="M 210 216 C 240 232 310 242 325 286 C 340 326 290 350 250 330
                              C 220 315 207 266 210 216 Z"/>

      <!-- wing spots -->
      <circle class="region" cx="102" cy="142" r="20"/>
      <circle class="region" cx="298" cy="142" r="20"/>
      <circle class="region" cx="146" cy="188" r="11"/>
      <circle class="region" cx="254" cy="188" r="11"/>
      <circle class="region" cx="128" cy="292" r="16"/>
      <circle class="region" cx="272" cy="292" r="16"/>

      <!-- body -->
      <path class="region" d="M 200 112 C 210 112 215 145 215 200 C 215 258 209 292 200 292
                              C 191 292 185 258 185 200 C 185 145 190 112 200 112 Z"/>
      <circle class="region" cx="200" cy="98" r="19"/>

      <!-- antennae -->
      <path class="line" d="M 192 84 C 176 58 160 46 146 42"/>
      <path class="line" d="M 208 84 C 224 58 240 46 254 42"/>
      <circle class="ink" cx="144" cy="40" r="7"/>
      <circle class="ink" cx="256" cy="40" r="7"/>
      <circle class="ink" cx="193" cy="94" r="4"/>
      <circle class="ink" cx="207" cy="94" r="4"/>
    `
  },

  /* --------------------------------------------------------------- TURTLE */
  {
    id: 'turtle',
    name: 'Turtle',
    viewBox: '0 0 400 400',
    svg: `
      <!-- legs and tail behind the shell -->
      <path class="region" d="M 282 236 C 306 252 308 288 280 292 C 256 294 246 268 252 238 Z"/>
      <path class="region" d="M 118 236 C 94 252 92 288 120 292 C 144 294 154 268 148 238 Z"/>
      <path class="region" d="M 100 208 C 72 222 54 240 46 258 C 66 256 90 246 106 234 Z"/>

      <!-- head -->
      <path class="region" d="M 300 222 C 322 224 344 218 360 202 C 378 184 380 158 366 146
                              C 350 132 326 140 316 158 C 306 176 300 198 300 222 Z"/>
      <circle class="ink" cx="346" cy="160" r="7"/>
      <path class="line" d="M 371 177 C 363 183 353 183 347 179"/>

      <!-- shell -->
      <path class="region" d="M 85 218 C 85 126 140 78 200 78 C 260 78 315 126 315 218
                              C 315 246 85 246 85 218 Z"/>

      <!-- shell plates -->
      <path class="region" d="M 172 120 L 228 120 L 242 158 L 228 198 L 172 198 L 158 158 Z"/>
      <path class="region" d="M 152 126 L 152 184 L 114 194 L 104 154 L 126 120 Z"/>
      <path class="region" d="M 248 126 L 248 184 L 286 194 L 296 154 L 274 120 Z"/>
      <path class="region" d="M 172 114 L 228 114 L 232 94 C 212 86 188 86 168 94 Z"/>

      <!-- shell rim -->
      <path class="line" d="M 88 222 C 140 244 260 244 312 222"/>

      <!-- grass -->
      <path class="line" d="M 40 300 C 44 282 52 274 58 270"/>
      <path class="line" d="M 58 300 C 58 284 64 274 72 268"/>
      <path class="line" d="M 342 300 C 346 282 354 274 360 270"/>
      <path class="line" d="M 360 300 C 360 284 366 274 374 268"/>
      <path class="line" d="M 20 300 L 380 300"/>
    `
  },

  /* ------------------------------------------------------------------ OWL */
  {
    id: 'owl',
    name: 'Owl',
    viewBox: '0 0 400 400',
    svg: `
      <!-- ear tufts behind the head -->
      <path class="region" d="M 120 96 L 134 26 L 176 78 Z"/>
      <path class="region" d="M 280 96 L 266 26 L 224 78 Z"/>

      <!-- body -->
      <path class="region" d="M 200 66 C 130 66 96 138 96 218 C 96 300 142 348 200 348
                              C 258 348 304 300 304 218 C 304 138 270 66 200 66 Z"/>

      <!-- belly -->
      <path class="region" d="M 200 198 C 166 198 150 248 156 292 C 166 328 234 328 244 292
                              C 250 248 234 198 200 198 Z"/>

      <!-- wings -->
      <path class="region" d="M 128 150 C 102 192 102 262 128 302 C 146 272 150 190 128 150 Z"/>
      <path class="region" d="M 272 150 C 298 192 298 262 272 302 C 254 272 250 190 272 150 Z"/>

      <!-- eyes -->
      <circle class="region" cx="163" cy="152" r="38"/>
      <circle class="region" cx="237" cy="152" r="38"/>
      <circle class="region" cx="163" cy="152" r="19"/>
      <circle class="region" cx="237" cy="152" r="19"/>
      <circle class="ink" cx="163" cy="152" r="9"/>
      <circle class="ink" cx="237" cy="152" r="9"/>

      <!-- beak -->
      <path class="region" d="M 200 176 L 219 200 L 200 222 L 181 200 Z"/>

      <!-- branch and feet -->
      <path class="line" d="M 176 348 L 170 368"/>
      <path class="line" d="M 190 348 L 188 368"/>
      <path class="line" d="M 210 348 L 212 368"/>
      <path class="line" d="M 224 348 L 230 368"/>
      <rect class="region" x="50" y="358" width="300" height="24" rx="12"/>
    `
  },

  /* -------------------------------------------------------------- GIRAFFE */
  {
    id: 'giraffe',
    name: 'Giraffe',
    viewBox: '0 0 400 400',
    svg: `
      <!-- tail, legs and mane first: the body and neck hide the joins -->
      <path class="region" d="M 100 214 C 74 230 54 258 50 288 L 76 294 C 80 264 92 244 114 232 Z"/>
      <path class="region" d="M 50 284 C 40 294 38 310 48 318 C 58 326 70 318 70 306
                              C 70 294 60 282 50 284 Z"/>

      <path class="region" d="M 108 278 C 104 312 104 334 106 350 L 130 350 C 130 332 130 308 132 278 Z"/>
      <path class="region" d="M 142 278 C 138 312 138 334 140 350 L 164 350 C 164 332 162 308 164 278 Z"/>
      <path class="region" d="M 190 278 C 186 312 186 334 188 350 L 212 350 C 212 332 210 308 212 278 Z"/>
      <path class="region" d="M 222 278 C 218 312 218 334 220 350 L 244 350 C 244 332 242 308 244 278 Z"/>
      <path class="region" d="M 104 350 L 132 350 L 134 368 L 102 368 Z"/>
      <path class="region" d="M 138 350 L 166 350 L 168 368 L 136 368 Z"/>
      <path class="region" d="M 186 350 L 214 350 L 216 368 L 184 368 Z"/>
      <path class="region" d="M 218 350 L 246 350 L 248 368 L 216 368 Z"/>

      <path class="region" d="M 244 92 C 220 140 198 192 194 246 L 174 240
                              C 178 186 202 132 228 84 Z"/>

      <!-- neck, then body over its base -->
      <path class="region" d="M 244 92 C 220 140 198 192 194 246 L 250 252
                              C 256 198 276 148 298 104 Z"/>
      <path class="region" d="M 78 250 C 78 212 108 196 160 196 C 218 196 254 214 254 254
                              C 254 292 220 306 160 306 C 108 306 78 288 78 250 Z"/>

      <!-- horns and ear tuck behind the head -->
      <path class="region" d="M 256 60 C 250 42 252 26 260 24 C 268 22 272 36 270 58 Z"/>
      <path class="region" d="M 288 50 C 286 32 292 20 300 20 C 308 20 310 34 304 52 Z"/>
      <circle class="region" cx="262" cy="22" r="9"/>
      <circle class="region" cx="302" cy="20" r="9"/>
      <path class="region" d="M 254 70 C 238 56 220 56 216 66 C 212 76 230 86 252 84 Z"/>

      <path class="region" d="M 246 98 C 236 76 246 52 270 46 C 294 40 318 50 332 64
                              C 342 74 340 86 326 90 C 300 97 264 104 248 102 Z"/>

      <!-- spots -->
      <path class="region" d="M 106 226 L 126 218 L 140 230 L 136 248 L 118 256 L 102 244 Z"/>
      <path class="region" d="M 158 212 L 180 208 L 192 222 L 186 240 L 166 246 L 152 232 Z"/>
      <path class="region" d="M 96 266 L 116 260 L 128 272 L 124 288 L 106 294 L 92 280 Z"/>
      <path class="region" d="M 152 260 L 174 256 L 188 268 L 184 286 L 164 292 L 148 278 Z"/>
      <path class="region" d="M 200 238 L 220 234 L 232 246 L 228 262 L 210 268 L 196 254 Z"/>
      <path class="region" d="M 222 176 L 240 172 L 250 182 L 246 196 L 228 200 L 218 188 Z"/>
      <path class="region" d="M 235 142 L 253 138 L 263 148 L 259 162 L 241 166 L 231 154 Z"/>
      <path class="region" d="M 244 110 L 262 106 L 272 116 L 268 130 L 250 134 L 240 122 Z"/>

      <!-- face -->
      <circle class="region" cx="272" cy="64" r="11"/>
      <circle class="ink" cx="273" cy="65" r="5"/>
      <ellipse class="ink" cx="326" cy="72" rx="4.5" ry="3.5"/>
      <path class="line" d="M 336 82 C 328 88 316 90 306 88"/>
      <path class="line" d="M 26 370 L 374 370"/>
    `
  }

];
