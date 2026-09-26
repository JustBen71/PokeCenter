import unittest
from apps.agent.agent import State
class ValidationTest(unittest.TestCase):
 def test_rejects_impossible_hp(self):
  with self.assertRaises(Exception): State.model_validate({"protocolVersion":1,"playerId":"p1","game":{"name":"pokemon-emerald","romStatus":"recognized"},"trainer":None,"location":None,"party":[{"slot":1,"speciesId":1,"speciesName":"Bulbizarre","level":5,"currentHp":21,"maxHp":20,"shiny":False}],"observedAt":"2026-01-01T00:00:00Z"})
