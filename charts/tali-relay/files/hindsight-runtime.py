"""Bind knowledge-page inference to its Bank on the pinned Hindsight 1.1 API."""
from importlib.metadata import entry_points, version
import sys


def bind_knowledge_page_operations():
    if version('hindsight-api-slim') != '1.1.0':
        raise RuntimeError('Review Bank context integration before upgrading Hindsight')
    from hindsight_api.engine.memory_engine import MemoryEngine, _bind_bank_id

    # Hindsight 1.1 binds retain/recall/reflect but omits knowledge-page calls.
    # Reuse its task-local set/reset decorator; never relax the router's Bank
    # requirement or replace it with a process-wide/default Project identity.
    for name in ('search_knowledge_pages', 'create_knowledge_page', 'update_knowledge_node'):
        setattr(MemoryEngine, name, _bind_bank_id()(getattr(MemoryEngine, name)))


if __name__ == '__main__':
    command = sys.argv.pop(1)
    if command not in ('hindsight-api', 'hindsight-worker'):
        raise ValueError('Unsupported Hindsight process')
    bind_knowledge_page_operations()
    main = next(iter(entry_points(group='console_scripts', name=command))).load()
    sys.exit(main())
