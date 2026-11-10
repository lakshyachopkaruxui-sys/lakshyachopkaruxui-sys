from pathlib import Path
import os
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
offices=list((ROOT/'tools/document-renderer/extracted').rglob('soffice.exe'))
if not offices: raise SystemExit('Portable LibreOffice has not finished extraction')
env=os.environ.copy()
env['PATH']=str(offices[0].parent)+os.pathsep+env.get('PATH','')
renderer=Path(sys.argv[1])
command=[sys.executable,str(renderer),str(ROOT/'docs/TEAR_Complete_Project_Handoff.docx'),'--output_dir',str(ROOT/'validation/document-qa'),'--emit_pdf']
result=subprocess.run(command,env=env,creationflags=subprocess.CREATE_NO_WINDOW)
raise SystemExit(result.returncode)
