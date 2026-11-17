import json
import pathlib
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
import research_api as api


class CompletionHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.requests.append((self.path,body))
        text=json.dumps({'translations':[{'id':'s1','zh':'纳入 120 名参与者。'},{'id':'s2','zh':'对图像进行独立阅片。'}]},ensure_ascii=False)
        data=json.dumps({'model':'example-api','choices':[{'message':{'role':'assistant','content':text}}]}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)


class ModelTranslation(unittest.TestCase):
    def test_translate_keeps_original_sentences_with_matching_ids(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),CompletionHandler);server.requests=[]
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            config={'url':f'http://127.0.0.1:{server.server_port}/v1','model':'example-api','key':'example-test-key'}
            segments=[{'id':'s1','en':'We included 120 participants.'},{'id':'s2','en':'Images were read independently.'}]
            result=api.translate_segments(config,segments)
            self.assertEqual(result['segments'],[{'id':'s1','en':'We included 120 participants.','zh':'纳入 120 名参与者。'},{'id':'s2','en':'Images were read independently.','zh':'对图像进行独立阅片。'}])
            path,body=server.requests[0]
            self.assertEqual(path,'/v1/chat/completions')
            self.assertFalse(body['stream'])
            self.assertEqual(body['model'],'example-api')
        finally:
            server.shutdown();server.server_close()


if __name__=='__main__':unittest.main(verbosity=2)
