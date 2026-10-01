package com.prime.airdefense.beta;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.view.View;
import android.view.WindowManager;
import android.graphics.Color;
import java.io.IOException;

/** Offline HTML/canvas engine hosted on a local secure origin. No network permission. */
public final class MainActivity extends Activity {
  private WebView web;
  private static final String ORIGIN="https://airdefense.local/";
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,WindowManager.LayoutParams.FLAG_FULLSCREEN);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if(android.os.Build.VERSION.SDK_INT>=28){WindowManager.LayoutParams lp=getWindow().getAttributes();lp.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;getWindow().setAttributes(lp);}
    web=new WebView(this);web.setBackgroundColor(Color.BLACK);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.getSettings().setMediaPlaybackRequiresUserGesture(true);
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !request.getUrl().toString().startsWith(ORIGIN);}
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
        String url=request.getUrl().toString();
        if(!url.startsWith(ORIGIN))return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
        String path=request.getUrl().getPath().substring(1);
        if(path.isEmpty())path="index.html";
        if(path.contains(".."))return null;
        String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":"text/html";
        try{return new WebResourceResponse(mime,"UTF-8",getAssets().open(path));}
        catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream("Missing asset".getBytes()));}
      }
    });
    setContentView(web);immersive();web.loadUrl(ORIGIN+"index.html");
  }
  private void immersive(){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
  @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)immersive();}
  @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.AirDefense && window.AirDefense.pause()",null);web.onPause();}super.onPause();}
  @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
  @Override public void onBackPressed(){if(web!=null)web.evaluateJavascript("document.getElementById('help').click()",null);}
  @Override protected void onDestroy(){if(web!=null)web.destroy();super.onDestroy();}
}
