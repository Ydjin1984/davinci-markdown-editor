package io.davinci.markdown

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.BufferedReader
import java.io.InputStreamReader

@InvokeArg
class DocumentArgs {
  lateinit var uri: String
}

@InvokeArg
class WriteArgs {
  lateinit var uri: String
  lateinit var content: String
}

@InvokeArg
class SaveFileArgs {
  lateinit var name: String
  var mimeType: String? = null
  /** Present for symmetry with the Rust caller; the write happens afterwards. */
  var content: String? = null
}

/**
 * Android side of the desktop features that have no direct equivalent.
 *
 * A document on Android is a `content://` URI issued by the system's own file
 * picker, so it is read and written through `ContentResolver` rather than by
 * path. Printing uses `PrintManager`, whose dialog offers "Save as PDF" —
 * the same outcome as the desktop print dialog, produced by the same webview
 * and therefore the same `@media print` stylesheet.
 *
 * The plugin is registered from Rust (`src-tauri/src/mobile.rs`), which is why
 * nothing here is referenced from `MainActivity`.
 */
@TauriPlugin
class MobilePlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null

  override fun load(webView: WebView) {
    this.webView = webView
    instance = this
  }

  // -------------------------------------------------------------------------
  // Reading and writing
  // -------------------------------------------------------------------------

  @Command
  fun readText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(DocumentArgs::class.java)
      val uri = Uri.parse(args.uri)
      val result = JSObject()
      result.put("content", readTextFrom(uri))
      result.put("name", displayName(uri))
      result.put("size", sizeOf(uri))
      result.put("modifiedMs", lastModified(uri))
      invoke.resolve(result)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "The document could not be read.", ex)
    }
  }

  @Command
  fun writeText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(WriteArgs::class.java)
      val uri = Uri.parse(args.uri)
      writeTextTo(uri, args.content)

      val result = JSObject()
      result.put("name", displayName(uri))
      result.put("size", sizeOf(uri))
      result.put("modifiedMs", lastModified(uri))
      invoke.resolve(result)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "The document could not be saved.", ex)
    }
  }

  // -------------------------------------------------------------------------
  // Pickers
  // -------------------------------------------------------------------------

  /**
   * Ask for a document to open.
   *
   * `ACTION_OPEN_DOCUMENT` is used rather than `ACTION_GET_CONTENT` because
   * only the former grants a permission that survives a restart — and a
   * document the user opened yesterday is expected to still open today.
   */
  @Command
  fun pickDocument(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      // Markdown reaches Android under several media types depending on the
      // provider; showing every file is more useful than hiding the one the
      // user wants behind a filter they cannot see.
      intent.type = "*/*"
      intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
      startActivityForResult(invoke, intent, "pickDocumentResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "The file picker could not be opened.", ex)
    }
  }

  @ActivityCallback
  fun pickDocumentResult(invoke: Invoke, result: ActivityResult) {
    when (result.resultCode) {
      Activity.RESULT_OK -> {
        val uri = result.data?.data
        if (uri == null) {
          invoke.resolve()
          return
        }
        rememberAccess(uri, includeWrite = true)
        invoke.resolve(describe(uri))
      }
      // A cancelled picker is an ordinary answer, not a failure: resolving
      // without a URI lets the caller simply do nothing.
      else -> invoke.resolve()
    }
  }

  /** Ask where to put a new file; the caller writes to the URI afterwards. */
  @Command
  fun pickSaveFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SaveFileArgs::class.java)
      val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.type = args.mimeType ?: "text/markdown"
      intent.putExtra(Intent.EXTRA_TITLE, args.name)
      intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
      startActivityForResult(invoke, intent, "pickSaveFileResult")
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "The save dialog could not be opened.", ex)
    }
  }

  @ActivityCallback
  fun pickSaveFileResult(invoke: Invoke, result: ActivityResult) {
    when (result.resultCode) {
      Activity.RESULT_OK -> {
        val uri = result.data?.data
        if (uri == null) {
          invoke.resolve()
          return
        }
        rememberAccess(uri, includeWrite = true)
        invoke.resolve(describe(uri))
      }
      else -> invoke.resolve()
    }
  }

  // -------------------------------------------------------------------------
  // Printing
  // -------------------------------------------------------------------------

  @Command
  fun printPage(invoke: Invoke) {
    val view = webView
    if (view == null) {
      invoke.reject("The page is not ready to print yet.")
      return
    }

    activity.runOnUiThread {
      try {
        val jobName = activity.applicationInfo.loadLabel(activity.packageManager).toString()
        val printManager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
        // The dialog this opens is where "Save as PDF" lives; the document is
        // rendered by the webview, so the printed pages match the preview.
        printManager.print(jobName, view.createPrintDocumentAdapter(jobName), null)
        invoke.resolve()
      } catch (ex: Exception) {
        invoke.reject(ex.message ?: "The print dialog could not be opened.", ex)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Files handed to us by the system
  // -------------------------------------------------------------------------

  /**
   * A file handed to the running application by another one — tapping a `.md`
   * document in a file manager, for instance.
   *
   * The base class forwards the intent to every plugin, so no change to
   * `MainActivity` is needed for this path.
   */
  override fun onNewIntent(intent: Intent) {
    val uri = intent.data ?: return
    deliverPendingUri(uri)
  }

  /**
   * Hand the URI to the interface, which takes it either from the event below
   * (application already running) or from `takeLaunchUri` on the next start.
   */
  private fun deliverPendingUri(uri: Uri) {
    rememberAccess(uri, includeWrite = true)
    pendingUri = uri.toString()
    val payload = JSObject()
    payload.put("uri", uri.toString())
    payload.put("name", displayName(uri))
    trigger(OPEN_URI_EVENT, payload)
  }

  @Command
  fun takeLaunchUri(invoke: Invoke) {
    val uri = pendingUri
    pendingUri = null
    if (uri == null) {
      invoke.resolve()
      return
    }
    val parsed = Uri.parse(uri)
    val result = JSObject()
    result.put("uri", uri)
    result.put("name", displayName(parsed))
    invoke.resolve(result)
  }

  // -------------------------------------------------------------------------
  // ContentResolver helpers
  // -------------------------------------------------------------------------

  private fun readTextFrom(uri: Uri): String {
    val input = activity.contentResolver.openInputStream(uri)
      ?: throw IllegalStateException("The file could not be opened.")
    input.use { stream ->
      val reader = BufferedReader(InputStreamReader(stream, Charsets.UTF_8))
      val builder = StringBuilder()
      val buffer = CharArray(64 * 1024)
      while (true) {
        val read = reader.read(buffer)
        if (read < 0) break
        builder.append(buffer, 0, read)
      }
      // A byte-order mark would otherwise show up as a stray character in the
      // editor and in the outline.
      if (builder.isNotEmpty() && builder[0] == '\uFEFF') builder.deleteCharAt(0)
      return builder.toString()
    }
  }

  private fun writeTextTo(uri: Uri, content: String) {
    val output = activity.contentResolver.openOutputStream(uri, "wt")
      ?: throw IllegalStateException("The file could not be written.")
    output.use { stream ->
      stream.write(content.toByteArray(Charsets.UTF_8))
      stream.flush()
    }
  }

  /** Keep the grant across restarts, so recent files keep working. */
  private fun rememberAccess(uri: Uri, includeWrite: Boolean) {
    val mode = if (includeWrite) {
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    } else {
      Intent.FLAG_GRANT_READ_URI_PERMISSION
    }
    try {
      activity.contentResolver.takePersistableUriPermission(uri, mode)
    } catch (_: SecurityException) {
      // The provider granted a one-shot permission only; the document still
      // works for this session.
    }
  }

  private fun describe(uri: Uri): JSObject {
    val result = JSObject()
    result.put("uri", uri.toString())
    result.put("name", displayName(uri))
    return result
  }

  private fun displayName(uri: Uri): String {
    queryColumn(uri, OpenableColumns.DISPLAY_NAME)?.let { return it }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document.md"
  }

  private fun sizeOf(uri: Uri): Long {
    queryColumn(uri, OpenableColumns.SIZE)?.toLongOrNull()?.let { return it }
    return 0L
  }

  private fun lastModified(uri: Uri): Long {
    queryColumn(uri, DocumentsContract.Document.COLUMN_LAST_MODIFIED)?.toLongOrNull()?.let {
      return it
    }
    return 0L
  }

  private fun queryColumn(uri: Uri, column: String): String? {
    return try {
      activity.contentResolver.query(uri, arrayOf(column), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null
      }
    } catch (_: Exception) {
      null
    }
  }

  companion object {
    /** Event the interface listens on for a file opened from outside the app. */
    const val OPEN_URI_EVENT = "android://open-uri"

    @Volatile private var instance: MobilePlugin? = null
    @Volatile private var pendingUri: String? = null

    /**
     * Cold start: remember a document the system opened the application with.
     *
     * Called from `MainActivity.onCreate`, before any plugin exists, so the URI
     * is parked and `takeLaunchUri` hands it over once the interface is up.
     */
    fun acceptLaunchIntent(context: Context, intent: Intent?) {
      val uri = intent?.data ?: return
      if (intent.action != Intent.ACTION_VIEW && intent.action != Intent.ACTION_SEND) return
      pendingUri = uri.toString()
      try {
        context.contentResolver.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      } catch (_: SecurityException) {
        // A one-shot grant is enough for this session.
      }
    }
  }
}
