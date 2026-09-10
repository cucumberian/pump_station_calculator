/-
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


-- ═════════ строка 1: Q_нс = 100 л/с · печать таблицы T_к = 15.61, W = 113.8 м³ ═════════
namespace Row1

/-- Атомы формулы (1): x = T_к/t_r = 1.561000, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = 1000 / 3423. -/
noncomputable def Av : ℝ := ((1.561000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := ((1000 / 3423 : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := ((0.561000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := (6846 / 43 : ℝ) * (Av - Bv - Cv - (9589 / 16300 : ℝ) + (430 / 1141 : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : (1.776191000000 : ℚ) ^ 100 ≤ (1.561000 : ℚ) ^ 129 := by native_decide
theorem A_hi_q : (1.561000 : ℚ) ^ 129 < (1.776192 : ℚ) ^ 100 := by native_decide
theorem C_lo_q : (0.474419000000 : ℚ) ^ 100 ≤ (0.561000 : ℚ) ^ 129 := by native_decide
theorem C_hi_q : (0.561000 : ℚ) ^ 129 < (0.474420000 : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : (0.014362080000 : ℚ) ^ 29 ≤ (1000 / 3423 : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : (1000 / 3423 : ℚ) ^ 100 < (0.0143620900000000 : ℚ) ^ 29 := by native_decide
theorem B_lo_q : (0.00419575000000 : ℚ) ^ 100 ≤ (0.014362080000 : ℚ) ^ 129 := by native_decide
theorem B_hi_q : (0.0143620900000000 : ℚ) ^ 129 < (0.0041957700000000 : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : (1.776191000000 : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff (1.561000 : ℚ) (1.776191000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < (1.776192 : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff (1.561000 : ℚ) (1.776192 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : (0.474419000000 : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff (0.561000 : ℚ) (0.474419000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < (0.474420000 : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff (0.561000 : ℚ) (0.474420000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : (0.014362080000 : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff (1000 / 3423 : ℚ) (0.014362080000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < (0.0143620900000000 : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff (1000 / 3423 : ℚ) (0.0143620900000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : (0.00419575000000 : ℝ) ≤ Bv :=
  le_trans (by
    show ((0.00419575000000 : ℚ) : ℝ) ≤ ((0.014362080000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff (0.014362080000 : ℚ) (0.00419575000000 : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ ((0.014362080000 : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < (0.0041957700000000 : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ ((0.014362080000 : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show ((0.0143620900000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < ((0.0041957700000000 : ℚ) : ℝ)
      exact (rpowRat_lt_iff (0.0143620900000000 : ℚ) (0.0041957700000000 : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [113.78777; 113.78809] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : (244643709549 / 2150000000 : ℝ) ≤ Wv ∧ Wv ≤ (48928880457 / 430000000 : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = 113.8 — округление точного W: |W − 113.8| ≤ 0,05. -/
theorem W_printed : |Wv - (113.8 : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [0.143621; 0.143621] (печать 0,14 при
Q_нс = 100 — округление; точное 0.143621). -/
theorem Tn_bounds : ((0.1436208000 : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ (0.14362090000000 : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : (1.13774908000000 : ℚ) ^ 100 ≤ (1.5605000 : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : (1.5605000 : ℚ) ^ 29 < (1.1377490900000000 : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : (0.845448050000000 : ℚ) ^ 100 ≤ (0.5605000 : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : (0.5605000 : ℚ) ^ 29 < (0.845448060000000 : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : (1.1379604700000000 : ℚ) ^ 100 ≤ (1.5615000 : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : (1.5615000 : ℚ) ^ 29 < (1.137960480000 : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : (0.845885200000 : ℚ) ^ 100 ≤ (0.5615000 : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : (0.5615000 : ℚ) ^ 29 < (0.8458852100000000 : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g(15.605) ≈ 100.0546 > 100. -/
theorem g_lo : g ((15.60500 : ℝ)) > ((100 : ℝ)) := by
  have hb2 : ((15.60500 : ℝ) / 10 - 1) = ((0.5605000 : ℝ)) := by norm_num
  have hb1 : ((15.60500 : ℝ) / 10) = ((1.5605000 : ℝ)) := by norm_num
  have h1 : ((1.13774908000000 : ℚ) : ℝ) ≤ ((1.5605000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.5605000 : ℚ) (1.13774908000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : ((1.5605000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.1377490900000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.5605000 : ℚ) (1.1377490900000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : ((0.845448050000000 : ℚ) : ℝ) ≤ ((0.5605000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.5605000 : ℚ) (0.845448050000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : ((0.5605000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.845448060000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.5605000 : ℚ) (0.845448060000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g(15.615) ≈ 99.9774 < 100. -/
theorem g_hi : g ((15.61500 : ℝ)) < ((100 : ℝ)) := by
  have hb2 : ((15.61500 : ℝ) / 10 - 1) = ((0.5615000 : ℝ)) := by norm_num
  have hb1 : ((15.61500 : ℝ) / 10) = ((1.5615000 : ℝ)) := by norm_num
  have h1 : ((1.1379604700000000 : ℚ) : ℝ) ≤ ((1.5615000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.5615000 : ℚ) (1.1379604700000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : ((1.5615000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.137960480000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.5615000 : ℚ) (1.137960480000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : ((0.845885200000 : ℚ) : ℝ) ≤ ((0.5615000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.5615000 : ℚ) (0.845885200000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : ((0.5615000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.8458852100000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.5615000 : ℚ) (0.8458852100000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [15.605; 15.615] — печатный
T_к = 15.61 верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc ((15.60500 : ℝ)) ((15.61500 : ℝ)), g T = ((100 : ℝ)) := by
  have hab : ((15.60500 : ℝ)) ≤ ((15.61500 : ℝ)) := by norm_num
  have hlo : g ((15.60500 : ℝ)) > ((100 : ℝ)) := g_lo
  have hhi : g ((15.61500 : ℝ)) < ((100 : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc ((15.60500 : ℝ)) ((15.61500 : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc ((15.60500 : ℝ)) ((15.61500 : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : ((100 : ℝ)) ∈ Icc (g ((15.61500 : ℝ))) (g ((15.60500 : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row1


-- ═════════ строка 2: Q_нс = 110 л/с · печать таблицы T_к = 14.47, W = 104.9 м³ ═════════
namespace Row2

/-- Атомы формулы (1): x = T_к/t_r = 1.447000, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = 1100 / 3423. -/
noncomputable def Av : ℝ := ((1.447000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := ((1100 / 3423 : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := ((0.447000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := (6846 / 43 : ℝ) * (Av - Bv - Cv - (684431 / 1141000 : ℝ) + (473 / 1141 : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : (1.610661000000 : ℚ) ^ 100 ≤ (1.447000 : ℚ) ^ 129 := by native_decide
theorem A_hi_q : (1.447000 : ℚ) ^ 129 < (1.61066200000 : ℚ) ^ 100 := by native_decide
theorem C_lo_q : (0.353913000000 : ℚ) ^ 100 ≤ (0.447000 : ℚ) ^ 129 := by native_decide
theorem C_hi_q : (0.447000 : ℚ) ^ 129 < (0.35391400000 : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : (0.0199503700000000 : ℚ) ^ 29 ≤ (1100 / 3423 : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : (1100 / 3423 : ℚ) ^ 100 < (0.019950380000000 : ℚ) ^ 29 := by native_decide
theorem B_lo_q : (0.00641116000000 : ℚ) ^ 100 ≤ (0.0199503700000000 : ℚ) ^ 129 := by native_decide
theorem B_hi_q : (0.019950380000000 : ℚ) ^ 129 < (0.0064111700000000 : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : (1.610661000000 : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff (1.447000 : ℚ) (1.610661000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < (1.61066200000 : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff (1.447000 : ℚ) (1.61066200000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : (0.353913000000 : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff (0.447000 : ℚ) (0.353913000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < (0.35391400000 : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff (0.447000 : ℚ) (0.35391400000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : (0.0199503700000000 : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff (1100 / 3423 : ℚ) (0.0199503700000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < (0.019950380000000 : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff (1100 / 3423 : ℚ) (0.019950380000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : (0.00641116000000 : ℝ) ≤ Bv :=
  le_trans (by
    show ((0.00641116000000 : ℚ) : ℝ) ≤ ((0.0199503700000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff (0.0199503700000000 : ℚ) (0.00641116000000 : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ ((0.0199503700000000 : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < (0.0064111700000000 : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ ((0.0199503700000000 : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show ((0.019950380000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < ((0.0064111700000000 : ℚ) : ℝ)
      exact (rpowRat_lt_iff (0.019950380000000 : ℚ) (0.0064111700000000 : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [104.87982; 104.88014] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : (14093225757 / 134375000 : ℝ) ≤ Wv ∧ Wv ≤ (112746150777 / 1075000000 : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = 104.9 — округление точного W: |W − 104.9| ≤ 0,05. -/
theorem W_printed : |Wv - (104.90 : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [0.199504; 0.199504] (печать 0,14 при
Q_нс = 100 — округление; точное 0.199504). -/
theorem Tn_bounds : ((0.19950370000000 : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ (0.1995038000000 : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : (1.1129927700000000 : ℚ) ^ 100 ≤ (1.4465000 : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : (1.4465000 : ℚ) ^ 29 < (1.112992780000000 : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : (0.79149508000000 : ℚ) ^ 100 ≤ (0.4465000 : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : (0.4465000 : ℚ) ^ 29 < (0.7914950900000000 : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : (1.113215860000000 : ℚ) ^ 100 ≤ (1.447500 : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : (1.447500 : ℚ) ^ 29 < (1.1132158700000000 : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : (0.7920087500000 : ℚ) ^ 100 ≤ (0.447500 : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : (0.447500 : ℚ) ^ 29 < (0.79200876000000 : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g(14.465) ≈ 110.0487 > 110. -/
theorem g_lo : g ((14.46500 : ℝ)) > ((110 : ℝ)) := by
  have hb2 : ((14.46500 : ℝ) / 10 - 1) = ((0.4465000 : ℝ)) := by norm_num
  have hb1 : ((14.46500 : ℝ) / 10) = ((1.4465000 : ℝ)) := by norm_num
  have h1 : ((1.1129927700000000 : ℚ) : ℝ) ≤ ((1.4465000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.4465000 : ℚ) (1.1129927700000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : ((1.4465000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.112992780000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.4465000 : ℚ) (1.112992780000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : ((0.79149508000000 : ℚ) : ℝ) ≤ ((0.4465000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.4465000 : ℚ) (0.79149508000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : ((0.4465000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.7914950900000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.4465000 : ℚ) (0.7914950900000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g(14.475) ≈ 109.9492 < 110. -/
theorem g_hi : g ((14.4750 : ℝ)) < ((110 : ℝ)) := by
  have hb2 : ((14.4750 : ℝ) / 10 - 1) = ((0.447500 : ℝ)) := by norm_num
  have hb1 : ((14.4750 : ℝ) / 10) = ((1.447500 : ℝ)) := by norm_num
  have h1 : ((1.113215860000000 : ℚ) : ℝ) ≤ ((1.447500 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.447500 : ℚ) (1.113215860000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : ((1.447500 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.1132158700000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.447500 : ℚ) (1.1132158700000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : ((0.7920087500000 : ℚ) : ℝ) ≤ ((0.447500 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.447500 : ℚ) (0.7920087500000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : ((0.447500 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.79200876000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.447500 : ℚ) (0.79200876000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [14.465; 14.475] — печатный
T_к = 14.47 верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc ((14.46500 : ℝ)) ((14.4750 : ℝ)), g T = ((110 : ℝ)) := by
  have hab : ((14.46500 : ℝ)) ≤ ((14.4750 : ℝ)) := by norm_num
  have hlo : g ((14.46500 : ℝ)) > ((110 : ℝ)) := g_lo
  have hhi : g ((14.4750 : ℝ)) < ((110 : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc ((14.46500 : ℝ)) ((14.4750 : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc ((14.46500 : ℝ)) ((14.4750 : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : ((110 : ℝ)) ∈ Icc (g ((14.4750 : ℝ))) (g ((14.46500 : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row2


-- ═════════ строка 3: Q_нс = 120 л/с · печать таблицы T_к = 13.58, W = 96.6 м³ ═════════
namespace Row3

/-- Атомы формулы (1): x = T_к/t_r = 1.35800, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = 400 / 1141. -/
noncomputable def Av : ℝ := ((1.35800 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := ((400 / 1141 : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := ((0.35800 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := (6846 / 43 : ℝ) * (Av - Bv - Cv - (12513 / 20375 : ℝ) + (516 / 1141 : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : (1.484023000000 : ℚ) ^ 100 ≤ (1.35800 : ℚ) ^ 129 := by native_decide
theorem A_hi_q : (1.35800 : ℚ) ^ 129 < (1.484024000 : ℚ) ^ 100 := by native_decide
theorem C_lo_q : (0.265771000000 : ℚ) ^ 100 ≤ (0.35800 : ℚ) ^ 129 := by native_decide
theorem C_hi_q : (0.35800 : ℚ) ^ 129 < (0.2657720000 : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : (0.02693124000000 : ℚ) ^ 29 ≤ (400 / 1141 : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : (400 / 1141 : ℚ) ^ 100 < (0.026931250000 : ℚ) ^ 29 := by native_decide
theorem B_lo_q : (0.0094412700000000 : ℚ) ^ 100 ≤ (0.02693124000000 : ℚ) ^ 129 := by native_decide
theorem B_hi_q : (0.026931250000 : ℚ) ^ 129 < (0.0094412900000000 : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : (1.484023000000 : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff (1.35800 : ℚ) (1.484023000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < (1.484024000 : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff (1.35800 : ℚ) (1.484024000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : (0.265771000000 : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff (0.35800 : ℚ) (0.265771000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < (0.2657720000 : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff (0.35800 : ℚ) (0.2657720000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : (0.02693124000000 : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff (400 / 1141 : ℚ) (0.02693124000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < (0.026931250000 : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff (400 / 1141 : ℚ) (0.026931250000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : (0.0094412700000000 : ℝ) ≤ Bv :=
  le_trans (by
    show ((0.0094412700000000 : ℚ) : ℝ) ≤ ((0.02693124000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff (0.02693124000000 : ℚ) (0.0094412700000000 : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ ((0.02693124000000 : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < (0.0094412900000000 : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ ((0.02693124000000 : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show ((0.026931250000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < ((0.0094412900000000 : ℚ) : ℝ)
      exact (rpowRat_lt_iff (0.026931250000 : ℚ) (0.0094412900000000 : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [96.61680; 96.61712] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : (41545223937 / 430000000 : ℝ) ≤ Wv ∧ Wv ≤ (207726812679 / 2150000000 : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = 96.6 — округление точного W: |W − 96.6| ≤ 0,05. -/
theorem W_printed : |Wv - (96.6 : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [0.269312; 0.269313] (печать 0,14 при
Q_нс = 100 — округление; точное 0.269312). -/
theorem Tn_bounds : ((0.269312400000 : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ (0.2693125000 : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : (1.0926839200000 : ℚ) ^ 100 ≤ (1.357500 : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : (1.357500 : ℚ) ^ 29 < (1.0926839300000000 : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : (0.74207884000000 : ℚ) ^ 100 ≤ (0.357500 : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : (0.357500 : ℚ) ^ 29 < (0.742078850000000 : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : (1.092917280000 : ℚ) ^ 100 ≤ (1.3585000 : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : (1.3585000 : ℚ) ^ 29 < (1.0929172900000000 : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : (0.7426802100000000 : ℚ) ^ 100 ≤ (0.3585000 : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : (0.3585000 : ℚ) ^ 29 < (0.742680220000000 : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g(13.575) ≈ 120.0121 > 120. -/
theorem g_lo : g ((13.5750 : ℝ)) > ((120 : ℝ)) := by
  have hb2 : ((13.5750 : ℝ) / 10 - 1) = ((0.357500 : ℝ)) := by norm_num
  have hb1 : ((13.5750 : ℝ) / 10) = ((1.357500 : ℝ)) := by norm_num
  have h1 : ((1.0926839200000 : ℚ) : ℝ) ≤ ((1.357500 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.357500 : ℚ) (1.0926839200000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : ((1.357500 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.0926839300000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.357500 : ℚ) (1.0926839300000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : ((0.74207884000000 : ℚ) : ℝ) ≤ ((0.357500 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.357500 : ℚ) (0.74207884000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : ((0.357500 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.742078850000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.357500 : ℚ) (0.742078850000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g(13.585) ≈ 119.8862 < 120. -/
theorem g_hi : g ((13.58500 : ℝ)) < ((120 : ℝ)) := by
  have hb2 : ((13.58500 : ℝ) / 10 - 1) = ((0.3585000 : ℝ)) := by norm_num
  have hb1 : ((13.58500 : ℝ) / 10) = ((1.3585000 : ℝ)) := by norm_num
  have h1 : ((1.092917280000 : ℚ) : ℝ) ≤ ((1.3585000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.3585000 : ℚ) (1.092917280000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : ((1.3585000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.0929172900000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.3585000 : ℚ) (1.0929172900000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : ((0.7426802100000000 : ℚ) : ℝ) ≤ ((0.3585000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.3585000 : ℚ) (0.7426802100000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : ((0.3585000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.742680220000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.3585000 : ℚ) (0.742680220000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [13.575; 13.585] — печатный
T_к = 13.58 верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc ((13.5750 : ℝ)) ((13.58500 : ℝ)), g T = ((120 : ℝ)) := by
  have hab : ((13.5750 : ℝ)) ≤ ((13.58500 : ℝ)) := by norm_num
  have hlo : g ((13.5750 : ℝ)) > ((120 : ℝ)) := g_lo
  have hhi : g ((13.58500 : ℝ)) < ((120 : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc ((13.5750 : ℝ)) ((13.58500 : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc ((13.5750 : ℝ)) ((13.58500 : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : ((120 : ℝ)) ∈ Icc (g ((13.58500 : ℝ))) (g ((13.5750 : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row3


-- ═════════ строка 4: Q_нс = 130 л/с · печать таблицы T_к = 12.87, W = 88.9 м³ ═════════
namespace Row4

/-- Атомы формулы (1): x = T_к/t_r = 1.287000, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = 1300 / 3423. -/
noncomputable def Av : ℝ := ((1.287000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := ((1300 / 3423 : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := ((0.287000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := (6846 / 43 : ℝ) * (Av - Bv - Cv - (719433 / 1141000 : ℝ) + (559 / 1141 : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : (1.38470200000 : ℚ) ^ 100 ≤ (1.287000 : ℚ) ^ 129 := by native_decide
theorem A_hi_q : (1.287000 : ℚ) ^ 129 < (1.384703000000 : ℚ) ^ 100 := by native_decide
theorem C_lo_q : (0.199833000000 : ℚ) ^ 100 ≤ (0.287000 : ℚ) ^ 129 := by native_decide
theorem C_hi_q : (0.287000 : ℚ) ^ 129 < (0.19983400000 : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : (0.035491600000 : ℚ) ^ 29 ≤ (1300 / 3423 : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : (1300 / 3423 : ℚ) ^ 100 < (0.0354916100000000 : ℚ) ^ 29 := by native_decide
theorem B_lo_q : (0.0134791300000000 : ℚ) ^ 100 ≤ (0.035491600000 : ℚ) ^ 129 := by native_decide
theorem B_hi_q : (0.0354916100000000 : ℚ) ^ 129 < (0.013479140000000 : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : (1.38470200000 : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff (1.287000 : ℚ) (1.38470200000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < (1.384703000000 : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff (1.287000 : ℚ) (1.384703000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : (0.199833000000 : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff (0.287000 : ℚ) (0.199833000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < (0.19983400000 : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff (0.287000 : ℚ) (0.19983400000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : (0.035491600000 : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff (1300 / 3423 : ℚ) (0.035491600000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < (0.0354916100000000 : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff (1300 / 3423 : ℚ) (0.0354916100000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : (0.0134791300000000 : ℝ) ≤ Bv :=
  le_trans (by
    show ((0.0134791300000000 : ℚ) : ℝ) ≤ ((0.035491600000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff (0.035491600000 : ℚ) (0.0134791300000000 : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ ((0.035491600000 : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < (0.013479140000000 : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ ((0.035491600000 : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show ((0.0354916100000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < ((0.013479140000000 : ℚ) : ℝ)
      exact (rpowRat_lt_iff (0.0354916100000000 : ℚ) (0.013479140000000 : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [88.87835; 88.87867] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : (95544224049 / 1075000000 : ℝ) ≤ Wv ∧ Wv ≤ (95544568899 / 1075000000 : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = 88.9 — округление точного W: |W − 88.9| ≤ 0,05. -/
theorem W_printed : |Wv - (88.90 : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [0.354916; 0.354916] (печать 0,14 при
Q_нс = 100 — округление; точное 0.354916). -/
theorem Tn_bounds : ((0.3549160000 : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ (0.35491610000000 : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : (1.0757933100000000 : ℚ) ^ 100 ≤ (1.2865000 : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : (1.2865000 : ℚ) ^ 29 < (1.07579332000000 : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : (0.6959309300000000 : ℚ) ^ 100 ≤ (0.2865000 : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : (0.2865000 : ℚ) ^ 29 < (0.695930940000000 : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : (1.076035740000000 : ℚ) ^ 100 ≤ (1.28750 : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : (1.28750 : ℚ) ^ 29 < (1.07603575000000 : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : (0.6966344900000000 : ℚ) ^ 100 ≤ (0.28750 : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : (0.28750 : ℚ) ^ 29 < (0.6966345000000 : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g(12.865) ≈ 130.0269 > 130. -/
theorem g_lo : g ((12.86500 : ℝ)) > ((130 : ℝ)) := by
  have hb2 : ((12.86500 : ℝ) / 10 - 1) = ((0.2865000 : ℝ)) := by norm_num
  have hb1 : ((12.86500 : ℝ) / 10) = ((1.2865000 : ℝ)) := by norm_num
  have h1 : ((1.0757933100000000 : ℚ) : ℝ) ≤ ((1.2865000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.2865000 : ℚ) (1.0757933100000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : ((1.2865000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.07579332000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.2865000 : ℚ) (1.07579332000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : ((0.6959309300000000 : ℚ) : ℝ) ≤ ((0.2865000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.2865000 : ℚ) (0.6959309300000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : ((0.2865000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.695930940000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.2865000 : ℚ) (0.695930940000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g(12.875) ≈ 129.8691 < 130. -/
theorem g_hi : g ((12.875 : ℝ)) < ((130 : ℝ)) := by
  have hb2 : ((12.875 : ℝ) / 10 - 1) = ((0.28750 : ℝ)) := by norm_num
  have hb1 : ((12.875 : ℝ) / 10) = ((1.28750 : ℝ)) := by norm_num
  have h1 : ((1.076035740000000 : ℚ) : ℝ) ≤ ((1.28750 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.28750 : ℚ) (1.076035740000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : ((1.28750 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.07603575000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.28750 : ℚ) (1.07603575000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : ((0.6966344900000000 : ℚ) : ℝ) ≤ ((0.28750 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.28750 : ℚ) (0.6966344900000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : ((0.28750 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.6966345000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.28750 : ℚ) (0.6966345000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [12.865; 12.875] — печатный
T_к = 12.87 верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc ((12.86500 : ℝ)) ((12.875 : ℝ)), g T = ((130 : ℝ)) := by
  have hab : ((12.86500 : ℝ)) ≤ ((12.875 : ℝ)) := by norm_num
  have hlo : g ((12.86500 : ℝ)) > ((130 : ℝ)) := g_lo
  have hhi : g ((12.875 : ℝ)) < ((130 : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc ((12.86500 : ℝ)) ((12.875 : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc ((12.86500 : ℝ)) ((12.875 : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : ((130 : ℝ)) ∈ Icc (g ((12.875 : ℝ))) (g ((12.86500 : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row4


-- ═════════ строка 5: Q_нс = 150 л/с · печать таблицы T_к = 11.84, W = 74.7 м³ ═════════
namespace Row5

/-- Атомы формулы (1): x = T_к/t_r = 1.184, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = 500 / 1141. -/
noncomputable def Av : ℝ := ((1.184 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := ((500 / 1141 : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := ((0.184 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := (6846 / 43 : ℝ) * (Av - Bv - Cv - (19092 / 28525 : ℝ) + (645 / 1141 : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : (1.2434360000 : ℚ) ^ 100 ≤ (1.184 : ℚ) ^ 129 := by native_decide
theorem A_hi_q : (1.184 : ℚ) ^ 129 < (1.243437000000 : ℚ) ^ 100 := by native_decide
theorem C_lo_q : (0.112619000000 : ℚ) ^ 100 ≤ (0.184 : ℚ) ^ 129 := by native_decide
theorem C_hi_q : (0.184 : ℚ) ^ 129 < (0.112620000 : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : (0.0581338100000000 : ℚ) ^ 29 ≤ (500 / 1141 : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : (500 / 1141 : ℚ) ^ 100 < (0.058133820000000 : ℚ) ^ 29 := by native_decide
theorem B_lo_q : (0.0254749300000000 : ℚ) ^ 100 ≤ (0.0581338100000000 : ℚ) ^ 129 := by native_decide
theorem B_hi_q : (0.058133820000000 : ℚ) ^ 129 < (0.025474950000000 : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : (1.2434360000 : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff (1.184 : ℚ) (1.2434360000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < (1.243437000000 : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff (1.184 : ℚ) (1.243437000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : (0.112619000000 : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff (0.184 : ℚ) (0.112619000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < (0.112620000 : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff (0.184 : ℚ) (0.112620000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : (0.0581338100000000 : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff (500 / 1141 : ℚ) (0.0581338100000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < (0.058133820000000 : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff (500 / 1141 : ℚ) (0.058133820000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : (0.0254749300000000 : ℝ) ≤ Bv :=
  le_trans (by
    show ((0.0254749300000000 : ℚ) : ℝ) ≤ ((0.0581338100000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff (0.0581338100000000 : ℚ) (0.0254749300000000 : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ ((0.0581338100000000 : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < (0.025474950000000 : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ ((0.0581338100000000 : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show ((0.058133820000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < ((0.025474950000000 : ℚ) : ℝ)
      exact (rpowRat_lt_iff (0.058133820000000 : ℚ) (0.025474950000000 : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [74.65262; 74.65294] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : (3210062673 / 43000000 : ℝ) ≤ Wv ∧ Wv ≤ (160503827031 / 2150000000 : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = 74.7 — округление точного W: |W − 74.7| ≤ 0,05. -/
theorem W_printed : |Wv - (74.70 : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [0.581338; 0.581338] (печать 0,14 при
Q_нс = 100 — округление; точное 0.581338). -/
theorem Tn_bounds : ((0.58133810000000 : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ (0.5813382000000 : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : (1.0500713100000000 : ℚ) ^ 100 ≤ (1.1835000 : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : (1.1835000 : ℚ) ^ 29 < (1.05007132000000 : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : (0.611581660000000 : ℚ) ^ 100 ≤ (0.1835000 : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : (0.1835000 : ℚ) ^ 29 < (0.6115816700000000 : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : (1.050328540000000 : ℚ) ^ 100 ≤ (1.1845000 : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : (1.1845000 : ℚ) ^ 29 < (1.050328550000000 : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : (0.6125463300000000 : ℚ) ^ 100 ≤ (0.1845000 : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : (0.1845000 : ℚ) ^ 29 < (0.612546340000000 : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g(11.835) ≈ 150.0950 > 150. -/
theorem g_lo : g ((11.83500 : ℝ)) > ((150 : ℝ)) := by
  have hb2 : ((11.83500 : ℝ) / 10 - 1) = ((0.1835000 : ℝ)) := by norm_num
  have hb1 : ((11.83500 : ℝ) / 10) = ((1.1835000 : ℝ)) := by norm_num
  have h1 : ((1.0500713100000000 : ℚ) : ℝ) ≤ ((1.1835000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.1835000 : ℚ) (1.0500713100000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : ((1.1835000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.05007132000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.1835000 : ℚ) (1.05007132000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : ((0.611581660000000 : ℚ) : ℝ) ≤ ((0.1835000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.1835000 : ℚ) (0.611581660000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : ((0.1835000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.6115816700000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.1835000 : ℚ) (0.6115816700000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g(11.845) ≈ 149.8529 < 150. -/
theorem g_hi : g ((11.84500 : ℝ)) < ((150 : ℝ)) := by
  have hb2 : ((11.84500 : ℝ) / 10 - 1) = ((0.1845000 : ℝ)) := by norm_num
  have hb1 : ((11.84500 : ℝ) / 10) = ((1.1845000 : ℝ)) := by norm_num
  have h1 : ((1.050328540000000 : ℚ) : ℝ) ≤ ((1.1845000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.1845000 : ℚ) (1.050328540000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : ((1.1845000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.050328550000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.1845000 : ℚ) (1.050328550000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : ((0.6125463300000000 : ℚ) : ℝ) ≤ ((0.1845000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.1845000 : ℚ) (0.6125463300000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : ((0.1845000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.612546340000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.1845000 : ℚ) (0.612546340000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [11.835; 11.845] — печатный
T_к = 11.84 верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc ((11.83500 : ℝ)) ((11.84500 : ℝ)), g T = ((150 : ℝ)) := by
  have hab : ((11.83500 : ℝ)) ≤ ((11.84500 : ℝ)) := by norm_num
  have hlo : g ((11.83500 : ℝ)) > ((150 : ℝ)) := g_lo
  have hhi : g ((11.84500 : ℝ)) < ((150 : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc ((11.83500 : ℝ)) ((11.84500 : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc ((11.83500 : ℝ)) ((11.84500 : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : ((150 : ℝ)) ∈ Icc (g ((11.84500 : ℝ))) (g ((11.83500 : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row5


-- ═════════ строка 6: Q_нс = 200 л/с · печать таблицы T_к = 10.55, W = 44.4 м³ ═════════
namespace Row6

/-- Атомы формулы (1): x = T_к/t_r = 1.05500, z = T_н/t_r = y^(100/29) (точный T_н,
формула (2)), y = Q_нс/Qr = 2000 / 3423. -/
noncomputable def Av : ℝ := ((1.05500 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
noncomputable def Zv : ℝ := ((2000 / 3423 : ℚ) : ℝ) ^ ((100 : ℝ) / 29)
noncomputable def Bv : ℝ := Zv ^ ((129 : ℝ) / 100)
noncomputable def Cv : ℝ := ((0.05500 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)

/-- Точное W формулы (1) при T_н из формулы (2) без округления и табличном T_к:
W = C·( A − B − C₀ − k·x + k·z ),  C = 6846/43, k = y·(129/100).
Совпадает с `calc()` из `static/js/hydro.js` с точным `tn`. -/
noncomputable def Wv : ℝ := (6846 / 43 : ℝ) * (Av - Bv - Cv - (9073 / 11410 : ℝ) + (860 / 1141 : ℝ) * Zv)

-- ── сертификаты атомов: целые сравнения в ℚ, проверяет их сам Lean ──
theorem A_lo_q : (1.0715080000 : ℚ) ^ 100 ≤ (1.05500 : ℚ) ^ 129 := by native_decide
theorem A_hi_q : (1.05500 : ℚ) ^ 129 < (1.071509000000 : ℚ) ^ 100 := by native_decide
theorem C_lo_q : (0.023717000000 : ℚ) ^ 100 ≤ (0.05500 : ℚ) ^ 129 := by native_decide
theorem C_hi_q : (0.05500 : ℚ) ^ 129 < (0.02371800000 : ℚ) ^ 100 := by native_decide
theorem Z_lo_q : (0.156766060000000 : ℚ) ^ 29 ≤ (2000 / 3423 : ℚ) ^ 100 := by native_decide
theorem Z_hi_q : (2000 / 3423 : ℚ) ^ 100 < (0.1567660700000000 : ℚ) ^ 29 := by native_decide
theorem B_lo_q : (0.0915957100000000 : ℚ) ^ 100 ≤ (0.156766060000000 : ℚ) ^ 129 := by native_decide
theorem B_hi_q : (0.1567660700000000 : ℚ) ^ 129 < (0.09159572000000 : ℚ) ^ 100 := by native_decide

-- ── перевод сертификатов в ℝ мостами ①/② (монотонность — для двухэтажного B) ──
theorem A_lo : (1.0715080000 : ℝ) ≤ Av := by
  unfold Av
  exact (rpowRat_le_iff (1.05500 : ℚ) (1.0715080000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_lo_q
theorem A_hi : Av < (1.071509000000 : ℝ) := by
  unfold Av
  exact (rpowRat_lt_iff (1.05500 : ℚ) (1.071509000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr A_hi_q
theorem C_lo : (0.023717000000 : ℝ) ≤ Cv := by
  unfold Cv
  exact (rpowRat_le_iff (0.05500 : ℚ) (0.023717000000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_lo_q
theorem C_hi : Cv < (0.02371800000 : ℝ) := by
  unfold Cv
  exact (rpowRat_lt_iff (0.05500 : ℚ) (0.02371800000 : ℚ) 129 100 (by norm_num) (by norm_num)
    (by norm_num)).mpr C_hi_q
theorem Z_lo : (0.156766060000000 : ℝ) ≤ Zv := by
  unfold Zv
  exact (rpowRat_le_iff (2000 / 3423 : ℚ) (0.156766060000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_lo_q
theorem Z_hi : Zv < (0.1567660700000000 : ℝ) := by
  unfold Zv
  exact (rpowRat_lt_iff (2000 / 3423 : ℚ) (0.1567660700000000 : ℚ) 100 29 (by norm_num) (by norm_num)
    (by norm_num)).mpr Z_hi_q

theorem B_lo : (0.0915957100000000 : ℝ) ≤ Bv :=
  le_trans (by
    show ((0.0915957100000000 : ℚ) : ℝ) ≤ ((0.156766060000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100)
    exact (rpowRat_le_iff (0.156766060000000 : ℚ) (0.0915957100000000 : ℚ) 129 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr B_lo_q)
    (rpow_le_rpow (by norm_num : (0 : ℝ) ≤ ((0.156766060000000 : ℚ) : ℝ)) (by simpa using Z_lo)
      (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
theorem B_hi : Bv < (0.09159572000000 : ℝ) :=
  lt_of_le_of_lt
    (rpow_le_rpow (le_trans (by norm_num : (0 : ℝ) ≤ ((0.156766060000000 : ℚ) : ℝ)) Z_lo)
      (le_of_lt Z_hi) (by norm_num : (0 : ℝ) ≤ (129 : ℝ) / 100))
    (by
      show ((0.1567660700000000 : ℚ) : ℝ) ^ ((129 : ℝ) / 100) < ((0.09159572000000 : ℚ) : ℝ)
      exact (rpowRat_lt_iff (0.1567660700000000 : ℚ) (0.09159572000000 : ℚ) 129 100 (by norm_num) (by norm_num)
        (by norm_num)).mpr B_hi_q)

/-- СЕРТИФИКАТ СТРОКИ: W ∈ [44.44695; 44.44727] (рамка ~10⁻³ из независимых рамок атомов). -/
theorem W_bounds : (23890236381 / 537500000 : ℝ) ≤ Wv ∧ Wv ≤ (95561636127 / 2150000000 : ℝ) := by
  constructor
  · unfold Wv
    nlinarith [A_lo, B_hi, C_hi, Z_lo]
  · unfold Wv
    nlinarith [A_hi, B_lo, C_lo, Z_hi]

/-- Печать метода W = 44.4 — округление точного W: |W − 44.4| ≤ 0,05. -/
theorem W_printed : |Wv - (44.4 : ℝ)| ≤ 1 / 20 := by
  obtain ⟨h1, h2⟩ := W_bounds
  rw [abs_le]
  constructor <;> linarith

/-- Точный T_н формулы (2): t_r·z ∈ [1.567661; 1.567661] (печать 0,14 при
Q_нс = 100 — округление; точное 1.567661). -/
theorem Tn_bounds : ((1.5676606000000 : ℝ) ≤ (10 : ℝ) * Zv) ∧ ((10 : ℝ) * Zv ≤ (1.56766070000000 : ℝ)) := by
  refine ⟨?_, ?_⟩
  · nlinarith [Z_lo]
  · nlinarith [le_of_lt Z_hi]

-- ── корень формулы (3): g(T) = Qr·[(T/t_r)^a − (T/t_r−1)^a], a = 29/100 ──
noncomputable def g (T : ℝ) : ℝ :=
  (3423 / 10 : ℝ) * ((T / 10) ^ ((29 : ℝ) / 100) - (T / 10 - 1) ^ ((29 : ℝ) / 100))

theorem g_lo1_q : (1.0155083700000000 : ℚ) ^ 100 ≤ (1.0545000 : ℚ) ^ 29 := by native_decide
theorem g_lo2_q : (1.0545000 : ℚ) ^ 29 < (1.015508380000000 : ℚ) ^ 100 := by native_decide
theorem g_lo3_q : (0.4300856800000 : ℚ) ^ 100 ≤ (0.0545000 : ℚ) ^ 29 := by native_decide
theorem g_lo4_q : (0.0545000 : ℚ) ^ 29 < (0.4300856900000000 : ℚ) ^ 100 := by native_decide
theorem g_hi1_q : (1.015787550000000 : ℚ) ^ 100 ≤ (1.0555000 : ℚ) ^ 29 := by native_decide
theorem g_hi2_q : (1.0555000 : ℚ) ^ 29 < (1.01578756000000 : ℚ) ^ 100 := by native_decide
theorem g_hi3_q : (0.432359450000000 : ℚ) ^ 100 ≤ (0.0555000 : ℚ) ^ 29 := by native_decide
theorem g_hi4_q : (0.0555000 : ℚ) ^ 29 < (0.432359460000000 : ℚ) ^ 100 := by native_decide

/-- Слева от печати g больше Q_нс: g(10.545) ≈ 200.3902 > 200. -/
theorem g_lo : g ((10.54500 : ℝ)) > ((200 : ℝ)) := by
  have hb2 : ((10.54500 : ℝ) / 10 - 1) = ((0.0545000 : ℝ)) := by norm_num
  have hb1 : ((10.54500 : ℝ) / 10) = ((1.0545000 : ℝ)) := by norm_num
  have h1 : ((1.0155083700000000 : ℚ) : ℝ) ≤ ((1.0545000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.0545000 : ℚ) (1.0155083700000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo1_q
  have h2 : ((1.0545000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.015508380000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.0545000 : ℚ) (1.015508380000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo2_q
  have h3 : ((0.4300856800000 : ℚ) : ℝ) ≤ ((0.0545000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.0545000 : ℚ) (0.4300856800000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo3_q
  have h4 : ((0.0545000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.4300856900000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.0545000 : ℚ) (0.4300856900000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_lo4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- Справа от печати g меньше Q_нс: g(10.555) ≈ 199.7074 < 200. -/
theorem g_hi : g ((10.55500 : ℝ)) < ((200 : ℝ)) := by
  have hb2 : ((10.55500 : ℝ) / 10 - 1) = ((0.0555000 : ℝ)) := by norm_num
  have hb1 : ((10.55500 : ℝ) / 10) = ((1.0555000 : ℝ)) := by norm_num
  have h1 : ((1.015787550000000 : ℚ) : ℝ) ≤ ((1.0555000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (1.0555000 : ℚ) (1.015787550000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi1_q
  have h2 : ((1.0555000 : ℝ)) ^ ((29 : ℝ) / 100) < ((1.01578756000000 : ℝ)) := by
    exact (rpowRat_lt_iff (1.0555000 : ℚ) (1.01578756000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi2_q
  have h3 : ((0.432359450000000 : ℚ) : ℝ) ≤ ((0.0555000 : ℝ)) ^ ((29 : ℝ) / 100) := by
    exact (rpowRat_le_iff (0.0555000 : ℚ) (0.432359450000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi3_q
  have h4 : ((0.0555000 : ℝ)) ^ ((29 : ℝ) / 100) < ((0.432359460000000 : ℝ)) := by
    exact (rpowRat_lt_iff (0.0555000 : ℚ) (0.432359460000000 : ℚ) 29 100 (by norm_num) (by norm_num)
      (by norm_num)).mpr g_hi4_q
  unfold g
  rw [hb2, hb1]
  norm_num at h1 h2 h3 h4 ⊢
  nlinarith

/-- СУЩЕСТВОВАНИЕ КОРНЯ: формула (3) разрешена в [10.545; 10.555] — печатный
T_к = 10.55 верен с шагом 0,01. (Единственность — монотонность g; здесь
довольно IVT.) -/
theorem root_exists :
    ∃ T ∈ Set.Icc ((10.54500 : ℝ)) ((10.55500 : ℝ)), g T = ((200 : ℝ)) := by
  have hab : ((10.54500 : ℝ)) ≤ ((10.55500 : ℝ)) := by norm_num
  have hlo : g ((10.54500 : ℝ)) > ((200 : ℝ)) := g_lo
  have hhi : g ((10.55500 : ℝ)) < ((200 : ℝ)) := g_hi
  have hdiv : ContinuousOn (fun x : ℝ => x / 10)
      (Icc ((10.54500 : ℝ)) ((10.55500 : ℝ))) :=
    ContinuousOn.div continuousOn_id continuousOn_const (fun _ _ => by
      have h : (0 : ℝ) < 10 := by norm_num
      exact ne_of_gt h)
  have hp : (0 : ℝ) ≤ (29 : ℝ) / 100 := by norm_num
  have hcont : ContinuousOn g (Icc ((10.54500 : ℝ)) ((10.55500 : ℝ))) := by
    refine ContinuousOn.mul continuousOn_const ?_
    refine ContinuousOn.sub ?_ ?_
    · refine ContinuousOn.rpow_const hdiv (fun _ _ => Or.inr hp)
    · refine ContinuousOn.rpow_const
        (ContinuousOn.sub hdiv continuousOn_const) (fun _ _ => Or.inr hp)
  have hmem : ((200 : ℝ)) ∈ Icc (g ((10.55500 : ℝ))) (g ((10.54500 : ℝ))) := by
    rw [mem_Icc]
    exact ⟨by linarith [hhi], by linarith [hlo]⟩
  obtain ⟨T, hT, hTeq⟩ := intermediate_value_Icc' hab hcont hmem
  exact ⟨T, hT, hTeq⟩

end Row6


-- ═════════ самопроверка: аксиомы ключевых теорем (видно в журнале сборки) ═════════
#print axioms Row1.W_printed
#print axioms Row1.root_exists
#print axioms rpowRat_le_iff

end Certificate
