# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# The mobile plugin is reached by name rather than by reference: Rust
# registers it with register_android_plugin(identifier, class) and Tauri's
# plugin manager looks the class up reflectively before dispatching @Command
# methods the same way. Shrinking the class, its name or its methods would
# break the file picker, saving and printing in release builds only.
-keep class io.davinci.markdown.MobilePlugin { *; }

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile