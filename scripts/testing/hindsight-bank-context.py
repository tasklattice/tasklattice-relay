"""Run in the pinned provider image: concurrent Bank calls must never mix."""
import asyncio
import runpy
from hindsight_api.engine.memory_engine import MemoryEngine, get_current_bank_id

names = ('search_knowledge_pages', 'create_knowledge_page', 'update_knowledge_node')


async def operation(self, bank_id, *, fail=False):
    await asyncio.sleep(0.01)
    assert get_current_bank_id() == bank_id
    if fail:
        raise RuntimeError('test failure')
    return get_current_bank_id()


for name in names:
    setattr(MemoryEngine, name, operation)
runpy.run_path('/etc/hindsight-launcher/runtime.py')['bind_knowledge_page_operations']()


async def main():
    engine = object.__new__(MemoryEngine)
    for name in names:
        call = getattr(engine, name)
        assert await asyncio.gather(call('bank-a'), call('bank-b')) == ['bank-a', 'bank-b']
        assert get_current_bank_id() is None
        try:
            await call('bank-c', fail=True)
        except RuntimeError:
            pass
        else:
            raise AssertionError('Expected test failure')
        assert get_current_bank_id() is None
    print('Hindsight 1.1: concurrent Bank context and exception cleanup passed')


asyncio.run(main())
