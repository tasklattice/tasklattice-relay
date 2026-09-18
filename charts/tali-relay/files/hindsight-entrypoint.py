"""Adapt one structured deployment file to Hindsight's upstream environment API."""
import json
import os
import sys

with open("/etc/hindsight/config.json", encoding="utf-8") as source:
    config = json.load(source)
role = sys.argv[1]
if role not in {"api", "worker", "migration"}:
    raise ValueError("Unknown Hindsight process role")
settings = dict(config["common"])
if role != "migration":
    settings.update(config[role])
if any(not isinstance(value, str) for value in settings.values()):
    raise ValueError("Hindsight settings must contain string values")
os.environ.update(settings)
command = ["hindsight-" + role]
if role == "migration":
    command = ["hindsight-admin", "run-db-migration", "--schema", config["migration"]["schema"],
               "--embedding-dimension", str(config["migration"]["embeddingDimensions"])]
os.execvp(command[0], command)
