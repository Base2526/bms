package com.bms.delivery.customer

import com.facebook.react.ReactActivity
import android.os.Bundle
import android.os.Build
import android.content.pm.PackageManager
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "BmsDeliveryCustomer"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle = Bundle().apply {
        // A test-target hint, not root/device attestation or production authority.
        val simulator = BuildConfig.DEBUG && (Build.FINGERPRINT.startsWith("generic") || Build.MODEL.contains("sdk_gphone"))
        val metadata = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA).metaData
        putBoolean("rideSimulator", simulator)
        putBoolean("rideMapsConfigured", BuildConfig.DEBUG && !metadata?.getString("com.google.android.geo.API_KEY").isNullOrBlank())
      }
    }
}
