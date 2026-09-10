/-
Формальная модель графа каскада КНС (`static/js/cascade.js`).

Мотивация — конкретная дыра. В JS цикл запрещает только `wouldCycle`, которую
вызывает UI при рисовании соединения; импорт схемы (`cascade-io.js`) проходит
мимо неё. А `topoOrder` в конце молча дописывает «потерянные» узлы:

    for (const id of ids) if (!order.includes(id)) order.push(id)

то есть зацикленную схему пересчёт не отвергает, а считает в произвольном
порядке. Ниже: модель графа, точное условие пригодности порядка для
однопроходного пересчёта и доказательство, что это условие несовместимо с
циклом. Вещественных степеней тут нет и не нужно, поэтому файл не импортирует
Mathlib (голый `Init`).
-/

namespace Graph

/-- Конечный граф: `g v` — непосредственные преемники `v`
(analog `outputs[_].connections` в Drawflow). -/
def Graph := Nat → List Nat

/-- Достижимость: транзитивное замыкание рёбер. -/
inductive Reaches (g : Graph) : Nat → Nat → Prop where
  | direct (u v : Nat) (h : v ∈ g u) : Reaches g u v
  | trans (u v w : Nat) : Reaches g u v → Reaches g v w → Reaches g u w

/-- Цикл — вершина, достижимая из себя же. -/
def Cyclic (g : Graph) : Prop := ∃ v, Reaches g v v

/-- Ранжирующая функция: строго растёт вдоль каждого ребра. Существование
такой функции — стандартный способ задать «граф ацикличен» без квантования
по путям. -/
def Rankable (g : Graph) (rank : Nat → Nat) : Prop :=
  ∀ u v, v ∈ g u → rank u < rank v

/-- Вдоль достижимости ранг строго растёт. -/
theorem reaches_rank_lt {g : Graph} {rank : Nat → Nat} (h : Rankable g rank) {u v : Nat}
    (hr : Reaches g u v) : rank u < rank v := by
  induction hr with
  | direct a b e => exact h a b e
  | trans a b c _ _ ih₁ ih₂ => exact Nat.lt_trans ih₁ ih₂

/-- Ацикличность из существования ранжирующей функции. -/
theorem acyclic_of_rankable {g : Graph} {rank : Nat → Nat} (h : Rankable g rank) : ¬ Cyclic g := by
  rintro ⟨v, hv⟩
  exact absurd (reaches_rank_lt h hv) (Nat.lt_irrefl (rank v))

/-- Позиция вершины в списке (0, если вершины там нет; в приложении порядок —
перестановка вершин). Рекурсией, а не `List.indexOf`: в голом `Init` его нет. -/
def idx : List Nat → Nat → Nat
  | [], _ => 0
  | w :: ws, v => if w == v then 0 else idx ws v + 1

/-- Порядок пригоден для однопроходного пересчёта: каждое ребро идёт строго
влево (источник левее приёмника). Именно это свойство `topoOrder` теряет на
ветке дописывания. Членства `u ∈ order`, `v ∈ order` в предпосылки не берём:
в приложении порядок — перестановка всех вершин, а без них лемма
`acyclic_of_topoOrder` формулируется прямо. -/
def TopoOrder (g : Graph) (order : List Nat) : Prop :=
  ∀ u v, v ∈ g u → idx order u < idx order v

/-- Замкнутость порядка: ребро из порядка не выводит из него. В `topoOrder`
нарушается ровно тогда, когда вершина не попала в очередь Кана, — тогда она
молча дописывается в хвост. -/
def Closed (g : Graph) (order : List Nat) : Prop :=
  ∀ u v, u ∈ order → v ∈ g u → v ∈ order

/-- Годный порядок ранжирует граф позициями. -/
theorem acyclic_of_topoOrder {g : Graph} {order : List Nat} (h : TopoOrder g order) :
    Rankable g (idx order) :=
  fun u v e => h u v e

theorem acyclic_of_topoOrder' {g : Graph} {order : List Nat} (h : TopoOrder g order) : ¬ Cyclic g :=
  acyclic_of_rankable (acyclic_of_topoOrder h)

/-
## Проверим на конкретных схемах

Ниже — корректный каскад и цикл, который `topoOrder` молча «починил» бы
дописыванием; обе проверки исполнимы (`decide`/`omega`).
-/

/-- Схема `catch → pump → delay`: рёбра направлены вдоль списка. -/
def cascadeOK : Graph :=
  fun u => if u = 1 then [2] else if u = 2 then [3] else []

/-- Тот же каскад с обратным ребром 3 → 1 (именно то, что пропустит импорт). -/
def cascadeCycle : Graph :=
  fun u => if u = 1 then [2] else if u = 2 then [3] else if u = 3 then [1] else []

/-- Порядок `[1, 2, 3]` пригоден для корректной схемы: рёбра `1→2`, `2→3`. -/
example : TopoOrder cascadeOK [1, 2, 3] := by
  intro u v e
  simp only [cascadeOK] at e
  by_cases h1 : u = 1
  · subst h1
    simp at e
    subst e
    decide
  · by_cases h2 : u = 2
    · subst h2
      simp at e
      subst e
      decide
    · simp [h1, h2] at e

/-- Для цикла с обратным ребром 3 → 1 порядок `[1, 2, 3]` непригоден: у него
`idx 3 = 2 ≮ 0 = idx 1`. -/
theorem cascadeCycle_not_topo : ¬ TopoOrder cascadeCycle [1, 2, 3] := by
  intro h
  have hmem : (1 : Nat) ∈ cascadeCycle 3 := by decide
  exact absurd (h 3 1 hmem) (by decide)

/-- Общая непротиворечивость: годный порядок влечёт ацикличность — то самое
утверждение, которым `topoOrder` обязан был бы завершаться отказом на цикле,
а не дописыванием потерянных узлов хвостом. -/
example (o : List Nat) (h : TopoOrder cascadeOK o) : ¬ Cyclic cascadeOK :=
  acyclic_of_topoOrder' h

end Graph
