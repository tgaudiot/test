# Theyr Voyage Viewer

## Run locally

Serve the static page with Python:

```bash
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/index.html` in your browser. Enter your bearer token and use the JSON payload to build query parameters for the GET `/Voyage` request.
