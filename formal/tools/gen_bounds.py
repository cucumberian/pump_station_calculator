#!/usr/bin/env python3
"""Генератор `Formal/Certificate.lean` — сертификата таблицы примера п. 5.1.

Python — только калькулятор: границы ищутся бисекцией по целочисленной
решётке (то точные дроби); float участвует лишь в sanity-ассертах
генератора и ни в одном решении Lean. Каждую границу Lean перепроверяет
сам: сравнение целых в ℚ делает `native_decide`, а перевод его в язык
вещественных степеней выполняет рукописная теорема-мост `rpowRat_le_iff`.
Доверия к генератору ноль: сфабрикованная граница уронит сборку.

Данные строк — золотой набор `tests/hydro.test.js` (печать методички
НИИ ВОДГЕО, пример п. 5.1): (Q_нс, T_к, W) = (100, 15,61, 113,8) … (200, 10,55, 44,4).

Математика строки (y = Q_нс/Qr, x = T_к/t_r, x⁻ = x−1, b = 129/100,
C = 0,06·Qr·t_r/b = 6846/43, k = y·b, точный T_н из формулы (2): z = y^(100/29)):

    W = C·( x^b − z^b − (x⁻)^b − k·x + k·z )                    — формула (1)
    g(T) = Qr·[ (T/t_r)^a − (T/t_r − 1)^a ],  a = 29/100        — формула (3)

Атомы: A = x^b, B = z^b (двухэтажный: z ∈ [Yl;Yu] ⇒ B ∈ [Yl^b;Yu^b]),
C₀ = (x⁻)^b, Z = z = y^(100/29). Каждый сжимается рамкой через мост
L ≤ X^(P/Q) ↔ L^Q ≤ X^P (X > 0, L,U ∈ ℚ).

    python3 tools/gen_bounds.py > Formal/Certificate.lean
"""
from fractions import Fraction as F

Qr, tr, n = F(3423, 10), F(10), F(71, 100)
b = 2 - n                                           # 129/100
C1 = F(6, 100) * Qr * tr / b                        # 6846/43
ZA = F(100, 29)                                     # 1/(1−n) — показатель точного T_н

# (Q_нс, T_к печать, W печать) — методичка п. 5.1 / tests/hydro.test.js
ROWS = [(100, F(1561, 100), F(1138, 10)),
        (110, F(1447, 100), F(1049, 10)),
        (120, F(1358, 100), F(966, 10)),
        (130, F(1287, 100), F(889, 10)),
        (150, F(1184, 100), F(747, 10)),
        (200, F(1055, 100), F(444, 10))]
ROOT_EPS = F(5, 1000)


def bracket(x: F, P: int, Q: int, prec: int = 6):
    """Рамка [L;U] с шагом 10^-prec для x^(P/Q): бисекция по целым, дроби."""
    assert x >= 0
    scale = 10 ** prec
    hi = (int(x) + 2) * scale
    while F(hi, scale) ** Q < x ** P:
        hi *= 2
    lo = 0
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if F(mid, scale) ** Q <= x ** P:
            lo = mid
        else:
            hi = mid
    L, U = F(lo, scale), F(lo + 1, scale)
    assert L ** Q <= x ** P and x ** P <= U ** Q
    return L, U


def rat(x: F) -> str:
    """Текст рационала: конечная десятичная дробь — десятицей, иначе N / D."""
    d, k = x.denominator, 0
    t = d
    while t % 2 == 0:
        t //= 2; k += 1
    while t % 5 == 0:
        t //= 5; k += 1
    if t != 1:
        return f"{x.numerator} / {x.denominator}"
    if k == 0:
        return str(x.numerator)
    v = abs(x.numerator) * 10 ** k // d
    assert abs(x.numerator) * 10 ** k == v * d
    s = str(v).rjust(k + 1, "0")
    return ("-" if x < 0 else "") + s[:-k] + "." + s[-k:]


HEAD = '''/-
АВТОГЕНЕРАТОР: `python3 tools/gen_bounds.py > Formal/Certificate.lean`.
Не редактировать вручную — править генератор и перегенерировать.

Точный сертификат таблицы примера п. 5.1 рекомендаций НИИ ВОДГЕО
(Qr = 342,3 л/с; t_r = 10 мин; n = 0,71; Q_нс = 100 … 200 л/с; данные —
золотой набор `tests/hydro.test.js`).

СХЕМА. Тактики `interval` из старых туториалов в Mathlib4 нет (есть только
`interval_cases`), поэтому всё через точные целые сравнения: при X > 0, q > 0
и L,U ∈ ℚ

    L ≤ X^(p/q) < U   ⟺   L^q ≤ X^p < U^q

(рукописные теоремы-мосты `rpowRat_le_iff`/`rpowRat_lt_iff`). Правую сторону
Lean проверяет сам (`native_decide`). `sorry` в файле нет. Аксиомы (печатает
в журнал сборки `#print axioms` в конце файла): сами мосты — только на
стандартных `propext`, `Classical.choice`, `Quot.sound`; теоремы-оценки —
 дополнительно на аксиомы `native_decide` по каждой целочисленной проверке
(это доверие к компилятору проверки, а не к человеку: ложное сравнение не
скомпилировалось бы никогда).

ДЛЯ КАЖДОЙ СТРОКИ (Q_нс; T_к — печать; W — печать):
* `W_bounds`  — W формулы (1) при ТОЧНОМ T_н формулы (2) и табличном T_к
  сжат рамкой шириной ~10⁻³;
* `W_printed` — |W − печать| ≤ 0,05: печать таблицы — округление точного W
  (худшая строка 150: точное 74,6528… против напечатанного 74,7);
* `Tn_bounds` — точный T_н формулы (2) в рамке 10⁻⁶ (в самой таблице столбца
  T_н нет; для Q_нс = 100 в тексте методички T_н = 0,14);
* `root_exists` — смена знака g − Q_нс на [T_к−0,005; T_к+0,005] и IVT:
  корень формулы (3) лежит в этом интервале ⇒ T_к напечатан верно с шагом
  0,01 (точный корень при Q_нс = 100 ≈ 15,6121).
-/

import Mathlib.Analysis.SpecialFunctions.Pow.Continuity
import Mathlib.Analysis.SpecialFunctions.Pow.Real
import Mathlib.Tactic

open Real Set Topology

namespace Certificate

/-- Мост ①: нижняя граница рациональной степени ⟺ целочисленное сравнение в ℚ. -/
theorem rpowRat_le_iff (x L : ℚ) (P Q : ℕ) (hx : 0 < x) (hL : 0 ≤ L) (hQ : 0 < Q) :
    L ≤ (x : ℝ) ^ ((P : ℝ) / Q) ↔ L ^ Q ≤ x ^ P := by
  have h0 : (0 : ℝ) ≤ x := by exact_mod_cast le_of_lt hx
  have hQ0 : (0 : ℝ) ≤ Q := by exact_mod_cast Nat.zero_le Q
  have hQp : (0 : ℝ) < Q := by exact_mod_cast hQ
  have hQz : (Q : ℝ) ≠ 0 := ne_of_gt hQp
  have key : ((x : ℝ) ^ ((P : ℝ) / Q)) ^ (Q : ℝ) = (x : ℝ) ^ (P : ℝ) := by
    rw [← rpow_mul h0, div_mul_cancel₀ (P : ℝ) hQz]
  constructor
  · intro h
    have hle : (L : ℝ) ^ (Q : ℝ) ≤ (x : ℝ) ^ (P : ℝ) := calc
      (L : ℝ) ^ (Q : ℝ) ≤ ((x : ℝ) ^ ((P : ℝ) / Q)) ^ (Q : ℝ) :=
        rpow_le_rpow (by exact_mod_cast hL) (by exact_mod_cast h) hQ0
      _ = (x : ℝ) ^ (P : ℝ) := key
    rw [rpow_natCast, rpow_natCast] at hle
    exact_mod_cast hle
  · intro h
    by_contra hc
    have hlt : (x : ℝ) ^ ((P : ℝ) / Q) < (L : ℝ) := lt_of_not_ge hc
    have hlt2 : (x : ℝ) ^ (P : ℝ) < (L : ℝ) ^ (Q : ℝ) := by
      rw [← key]
      exact rpow_lt_rpow (rpow_nonneg h0 _) hlt hQp
    rw [rpow_natCast, rpow_natCast] at hlt2
    exact absurd hlt2 (not_lt_of_ge (by exact_mod_cast h))

/-- Мост ②: строгая верхняя граница. -/
theorem rpowRat_lt_iff (x U : ℚ) (P Q : ℕ) (hx : 0 < x) (hU : 0 ≤ U) (hQ : 0 < Q) :
    (x : ℝ) ^ ((P : ℝ) / Q) < U ↔ x ^ P < U ^ Q := by
  have h0 : (0 : ℝ) ≤ x := by exact_mod_cast le_of_lt hx
  have hQp : (0 : ℝ) < Q := by exact_mod_cast hQ
  have hQz : (Q : ℝ) ≠ 0 := ne_of_gt hQp
  have key : ((x : ℝ) ^ ((P : ℝ) / Q)) ^ (Q : ℝ) = (x : ℝ) ^ (P : ℝ) := by
    rw [← rpow_mul h0, div_mul_cancel₀ (P : ℝ) hQz]
  constructor
  · intro h
    have hlt : (x : ℝ) ^ (P : ℝ) < (U : ℝ) ^ (Q : ℝ) := by
      rw [← key]
      exact rpow_lt_rpow (rpow_nonneg h0 _) h hQp
    rw [rpow_natCast, rpow_natCast] at hlt
    exact_mod_cast hlt
  · intro h
    by_contra hc
    have hge : (U : ℝ) ≤ (x : ℝ) ^ ((P : ℝ) / Q) := le_of_not_gt hc
    have hle : (U : ℝ) ^ (Q : ℝ) ≤ (x : ℝ) ^ (P : ℝ) := calc
      (U : ℝ) ^ (Q : ℝ) ≤ ((x : ℝ) ^ ((P : ℝ) / Q)) ^ (Q : ℝ) :=
        rpow_le_rpow (by positivity) hge (by exact_mod_cast Nat.zero_le Q)
      _ = (x : ℝ) ^ (P : ℝ) := key
    rw [rpow_natCast, rpow_natCast] at hle
    linarith [show ¬ ((x : ℝ) ^ P ≥ (U : ℝ) ^ Q) from
      not_le_of_gt (by exact_mod_cast h)]
'''

ROW_TMPL = '''
-- ═════════ строка {i}: Q_нс = {Qi} л/с · печать таблицы T_к = {Tks}, W = {Wps} м³ ═════════
namespace Row{i}

/-- Атомы формулы (1): x = T_к/t_r = {xs}, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = {ys}. -/
noncomputable def Av : ℝ := (({xq} : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := (({yq} : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := (({xmq} : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := ({C1r} : ℝ) * (Av - Bv - Cv - ({kx} : ℝ) + ({kr} : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : ({Al} : ℚ) ^ 100 ≤ ({xq} : ℚ) ^ 129 := by native_decide
theorem A_hi_q : ({xq} : ℚ) ^ 129 < ({Ah} : ℚ) ^ 100 := by native_decide
theorem C_lo_q : ({Cl} : ℚ) ^ 100 ≤ ({xmq} : ℚ) ^ 129 := by native_decide
theorem C_hi_q : ({xmq} : ℚ) ^ 129 < ({Ch} : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : ({Yl} : ℚ) ^ 29 ≤ ({yq} : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : ({yq} : ℚ) ^ 100 < ({Yu} : ℚ) ^ 29 := by native_decide
theorem B_lo_q : ({Bl} : ℚ) ^ 100 ≤ ({Yl} : ℚ) ^ 129 := by native_decide
theorem B_hi_q : ({Yu} : ℚ) ^ 129 < ({Bh} : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : ({Al} : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff ({xq} : ℚ) ({Al} : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < ({Ah} : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff ({xq} : ℚ) ({Ah} : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : ({Cl} : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff ({xmq} : ℚ) ({Cl} : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < ({Ch} : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff ({xmq} : ℚ) ({Ch} : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : ({Yl} : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff ({yq} : ℚ) ({Yl} : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < ({Yu} : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff ({yq} : ℚ) ({Yu} : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : ({Bl} : ℝ) ≤ Bv :=
  le_trans (by
    show (({Bl} : ℚ) : ℝ) ≤ (({Yl} : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff ({Yl} : ℚ) ({Bl} : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ (({Yl} : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < ({Bh} : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ (({Yl} : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show (({Yu} : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < (({Bh} : ℚ) : ℝ)
      exact (rpowRat_lt_iff ({Yu} : ℚ) ({Bh} : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [{Wlos}; {Whis}] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : ({Wlo} : ℝ) ≤ Wv ∧ Wv ≤ ({Whi} : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = {Wps} — округление точного W: |W − {Wps}| ≤ 0,05. -/
theorem W_printed : |Wv - ({Wp} : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [{TnLos}; {TnHis}] (печать 0,14 при
Q_нс = 100 — округление; точное {TnExs}). -/
theorem Tn_bounds : (({TnLo} : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ ({TnHi} : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : ({lo_L1} : ℚ) ^ 100 ≤ ({lo_x1} : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : ({lo_x1} : ℚ) ^ 29 < ({lo_U1} : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : ({lo_L2} : ℚ) ^ 100 ≤ ({lo_x2} : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : ({lo_x2} : ℚ) ^ 29 < ({lo_U2} : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : ({hi_L1} : ℚ) ^ 100 ≤ ({hi_x1} : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : ({hi_x1} : ℚ) ^ 29 < ({hi_U1} : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : ({hi_L2} : ℚ) ^ 100 ≤ ({hi_x2} : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : ({hi_x2} : ℚ) ^ 29 < ({hi_U2} : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g({Tlos}) ≈ {glos} > {Qi}. -/
theorem g_lo : g (({Tlo} : ℝ)) > (({Q} : ℝ)) := by
  have hb2 : (({Tlo} : ℝ) / 10 - 1) = (({lo_x2} : ℝ)) := by norm_num
  have hb1 : (({Tlo} : ℝ) / 10) = (({lo_x1} : ℝ)) := by norm_num
  have h1 : (({lo_L1} : ℚ) : ℝ) ≤ (({lo_x1} : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff ({lo_x1} : ℚ) ({lo_L1} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : (({lo_x1} : ℝ)) ^ ((29 : ℝ) / 100) < (({lo_U1} : ℝ)) := by
    exact (rpowRat_lt_iff ({lo_x1} : ℚ) ({lo_U1} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : (({lo_L2} : ℚ) : ℝ) ≤ (({lo_x2} : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff ({lo_x2} : ℚ) ({lo_L2} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : (({lo_x2} : ℝ)) ^ ((29 : ℝ) / 100) < (({lo_U2} : ℝ)) := by
    exact (rpowRat_lt_iff ({lo_x2} : ℚ) ({lo_U2} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g({This}) ≈ {ghis} < {Qi}. -/
theorem g_hi : g (({Thi} : ℝ)) < (({Q} : ℝ)) := by
  have hb2 : (({Thi} : ℝ) / 10 - 1) = (({hi_x2} : ℝ)) := by norm_num
  have hb1 : (({Thi} : ℝ) / 10) = (({hi_x1} : ℝ)) := by norm_num
  have h1 : (({hi_L1} : ℚ) : ℝ) ≤ (({hi_x1} : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff ({hi_x1} : ℚ) ({hi_L1} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : (({hi_x1} : ℝ)) ^ ((29 : ℝ) / 100) < (({hi_U1} : ℝ)) := by
    exact (rpowRat_lt_iff ({hi_x1} : ℚ) ({hi_U1} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : (({hi_L2} : ℚ) : ℝ) ≤ (({hi_x2} : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff ({hi_x2} : ℚ) ({hi_L2} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : (({hi_x2} : ℝ)) ^ ((29 : ℝ) / 100) < (({hi_U2} : ℝ)) := by
    exact (rpowRat_lt_iff ({hi_x2} : ℚ) ({hi_U2} : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [{Tlos}; {This}] — печатный
T_к = {Tks} верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc (({Tlo} : ℝ)) (({Thi} : ℝ)), g T = (({Q} : ℝ)) := by
  have hab : (({Tlo} : ℝ)) ≤ (({Thi} : ℝ)) := by norm_num
  have hlo : g (({Tlo} : ℝ)) > (({Q} : ℝ)) := g_lo
  have hhi : g (({Thi} : ℝ)) < (({Q} : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc (({Tlo} : ℝ)) (({Thi} : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc (({Tlo} : ℝ)) (({Thi} : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : (({Q} : ℝ)) ∈ Icc (g (({Thi} : ℝ))) (g (({Tlo} : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row{i}
'''

out = [HEAD]
summary = []

for i, (Qns_i, Tk, printed) in enumerate(ROWS, start=1):
    Qns = F(Qns_i)
    y = Qns / Qr
    x = Tk / tr
    xm = x - 1
    assert xm > 0
    kb = y * b
    kx = kb * x
    # рамки атомов (точные дроби)
    Al, Ah = bracket(x, 129, 100)
    Yl, Yu = bracket(y, 100, 29, prec=8)          # z = y^(100/29)
    Bl, _ = bracket(Yl, 129, 100, prec=8)         # B ≥ (Yl)^b
    _, Bh = bracket(Yu, 129, 100, prec=8)         # B < (Yu)^b
    Cl, Ch = bracket(xm, 129, 100)
    # sanity: точное W (float) внутри рамок и близко к печати
    zf = float(y) ** (100 / 29)
    Wex = (float(C1) * (float(x) ** float(b) - zf ** float(b)
           - float(xm) ** float(b) - float(kx) + float(kb) * zf))
    Wlo = C1 * (Al - Bh - Ch - kx + kb * Yl)
    Whi = C1 * (Ah - Bl - Cl - kx + kb * Yu)
    assert abs(float(Wlo) - Wex) < 3e-3 and abs(float(Whi) - Wex) < 3e-3, \
        f"row{i}: frame [{float(Wlo)};{float(Whi)}] vs {Wex}"
    assert abs(Wex - float(printed)) <= 0.05 + 1e-9, \
        f"row{i}: print {float(printed)} vs exact {Wex}"
    TnLo, TnHi = Yl * 10, Yu * 10
    TnEx = zf * 10
    assert float(TnLo) <= TnEx <= float(TnHi)
    # рамка корня: смена знака g − Q_нс на концах [Tk−0,005; Tk+0,005]
    ends = {}
    for tag, sgn in [("lo", -1), ("hi", 1)]:
        T = Tk + ROOT_EPS * sgn
        x1, x2 = T / 10, T / 10 - 1
        L1, U1 = bracket(x1, 29, 100, prec=8)
        L2, U2 = bracket(x2, 29, 100, prec=8)
        glo, ghi = float(Qr) * (float(L1) - float(U2)), float(Qr) * (float(U1) - float(L2))
        if sgn < 0:
            assert glo > float(Qns), f"row{i} {tag} {glo} !> {float(Qns)}"
        else:
            assert ghi < float(Qns), f"row{i} {tag} {ghi} !< {float(Qns)}"
        ends[tag] = (T, x1, L1, U1, x2, L2, U2, glo if sgn < 0 else ghi)

    subs = dict(
        i=i, Qi=Qns_i, Q=rat(Qns), Wp=rat(printed), Wps=f"{float(printed):.1f}",
        Tks=f"{float(Tk):.2f}",
        xs=rat(x), ys=rat(y), xq=rat(x), yq=rat(y), xmq=rat(xm),
        C1r=rat(C1), kr=rat(kb), kx=rat(kx),
        Al=rat(Al), Ah=rat(Ah), Bl=rat(Bl), Bh=rat(Bh), Cl=rat(Cl), Ch=rat(Ch),
        Yl=rat(Yl), Yu=rat(Yu),
        Wlo=rat(Wlo), Whi=rat(Whi), Wlos=f"{float(Wlo):.5f}", Whis=f"{float(Whi):.5f}",
        TnLo=rat(TnLo), TnHi=rat(TnHi), TnLos=f"{float(TnLo):.6f}", TnHis=f"{float(TnHi):.6f}",
        TnExs=f"{TnEx:.6f}",
        Tlo=rat(ends['lo'][0]), Thi=rat(ends['hi'][0]),
        Tlos=f"{float(ends['lo'][0]):.3f}", This=f"{float(ends['hi'][0]):.3f}",
        glos=f"{ends['lo'][7]:.4f}", ghis=f"{ends['hi'][7]:.4f}",
    )
    for tag in ("lo", "hi"):
        e = ends[tag]
        subs[f"{tag}_x1"] = rat(e[1]); subs[f"{tag}_L1"] = rat(e[2])
        subs[f"{tag}_U1"] = rat(e[3]); subs[f"{tag}_x2"] = rat(e[4])
        subs[f"{tag}_L2"] = rat(e[5]); subs[f"{tag}_U2"] = rat(e[6])
    out.append(ROW_TMPL.format(**subs))
    summary.append((i, Qns_i, float(Tk), float(Wex), float(printed),
                    float(Wlo), float(Whi), TnEx))

out.append("""
-- ═════════ самопроверка: аксиомы ключевых теорем (видно в журнале сборки) ═════════
#print axioms Row1.W_printed
#print axioms Row1.root_exists
#print axioms rpowRat_le_iff

end Certificate
""")
text = "\n".join(out)
# проверка: все плейсхолдеры заполнены
import re as _re
assert not _re.search(r"\{[A-Za-z_][A-Za-z_0-9]*\}", text), "незаполненный плейсхолдер"
open("/home/human/ai/ulia-excel/pump-station/formal/Formal/Certificate.lean", "w").write(text)

print(f"{'стр':>4} {'Q_нс':>5} {'T_к':>6} {'W точн':>10} {'печать':>7} {'рамка W':>22} {'T_н точн':>9}")
for i, Qi, tk, wex, wp, wlo, whi, tn in summary:
    print(f"{i:>4} {Qi:>5} {tk:>6.2f} {wex:>10.4f} {wp:>7.1f} "
          f"[{wlo:.5f}; {whi:.5f}] {tn:>9.6f}")
