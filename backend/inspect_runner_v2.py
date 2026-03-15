from google.adk.runners import Runner
import inspect

spec = inspect.getfullargspec(Runner.run)
print(f"Arguments: {spec.args}")
print(f"Keywords: {spec.kwonlyargs}")
if spec.varargs: print(f"Varargs: {spec.varargs}")
if spec.varkw: print(f"Varkw: {spec.varkw}")
