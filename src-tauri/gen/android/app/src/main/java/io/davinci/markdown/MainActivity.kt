package io.davinci.markdown

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // A document opened from a file manager arrives with the launching intent.
    // A later one is delivered by the plugin itself, through `onNewIntent`.
    MobilePlugin.acceptLaunchIntent(this, intent)
  }
}
