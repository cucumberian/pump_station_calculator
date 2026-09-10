/-
Корневой модуль формализации расчёта КНС (п. 5.1 рекомендаций НИИ ВОДГЕО).

Разделы:
* `Formal.Graph` — модель графа каскада (`static/js/cascade.js`) и инвариант
  ацикличности, нарушаемый веткой дописывания в `topoOrder`.
* `Formal.Certificate` — точный сертификат таблицы примера п. 5.1
  (W, T_н, T_к для Q_нс = 100…200); генерируется `tools/gen_bounds.py`.
-/

import Formal.Graph
import Formal.Certificate

